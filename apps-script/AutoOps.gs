// ============================================================
// AutoOps.gs — Automação, monitoramento e fail-safe do TROCA-POSTES
// Implementa execução periódica, logs, status e alerta em erro.
// ============================================================

const AUTO_OPS = {
  TZ: 'America/Sao_Paulo',
  PROCESS_INTERVAL_MIN: 15,
  HEALTH_HOUR: 8,
  MIN_EXPECTED_RECORDS: 1,
};

function processarTudoAutomatico() {
  const inicio = new Date();
  const contexto = {
    geocodificadas: 0,
    verificadas: 0,
    alertas: 0,
    totalTrocas: 0,
  };

  try {
    garantirAbasOperacionais_();
    registrarLogSistema_('INFO', 'PROCESSAR_AUTO', 'Início do processamento automático');

    const avisos = diagnosticoRapido();
    if (avisos && avisos.length) {
      registrarLogSistema_('WARN', 'PROCESSAR_AUTO', `Diagnóstico rápido com avisos: ${avisos.join(' | ')}`);
    }

    geocodificarTodas();
    verificarProximidadeTodas();
    verificarEEnviarAlertas();
    contexto.totalTrocas = contarTrocasAtuais_();

    exportarParaGitHubSeguro_();

    try {
      enviarNovasTrocasParaSupabase();
    } catch (supErr) {
      registrarLogSistema_('WARN', 'SUPABASE_SYNC', supErr.message, String(supErr.stack || ''));
      notificarErroOperacional_(`Falha no sync Supabase: ${supErr.message}`);
    }

    atualizarProcEm();

    const duracaoMs = new Date() - inicio;
    atualizarStatusSistema_('OK', contexto.totalTrocas, duracaoMs, 'Processamento concluído com sucesso');
    registrarLogSistema_('INFO', 'PROCESSAR_AUTO', `Concluído com sucesso. Total de trocas: ${contexto.totalTrocas}. Duração: ${duracaoMs} ms`);
  } catch (err) {
    const duracaoMs = new Date() - inicio;
    atualizarStatusSistema_('ERRO', contexto.totalTrocas, duracaoMs, err.message);
    registrarLogSistema_('ERROR', 'PROCESSAR_AUTO', err.message, String(err.stack || ''));
    notificarErroOperacional_(`Falha no processamento automático: ${err.message}`);
    throw err;
  }
}

function configurarTriggersAutomaticos() {
  removerTriggersAutomaticos_();

  ScriptApp.newTrigger('processarTudoAutomatico')
    .timeBased()
    .everyMinutes(AUTO_OPS.PROCESS_INTERVAL_MIN)
    .create();

  ScriptApp.newTrigger('verificarSaudeSistema_')
    .timeBased()
    .everyDays(1)
    .atHour(AUTO_OPS.HEALTH_HOUR)
    .inTimezone(AUTO_OPS.TZ)
    .create();

  registrarLogSistema_('INFO', 'TRIGGER_SETUP', `Triggers automáticos configurados: processamento a cada ${AUTO_OPS.PROCESS_INTERVAL_MIN} min + healthcheck diário`);
}

function removerTriggersAutomaticos_() {
  ScriptApp.getProjectTriggers().forEach(t => {
    const fn = t.getHandlerFunction();
    if (['processarTudoAutomatico', 'verificarSaudeSistema_'].includes(fn)) {
      ScriptApp.deleteTrigger(t);
    }
  });
}

function verificarSaudeSistema_() {
  try {
    garantirAbasOperacionais_();
    const ss = getSpreadsheet();
    const sh = ss.getSheetByName(SHEET.STATUS_SISTEMA);
    const ultimaExec = sh ? sh.getRange('A2').getValue() : null;
    const status = sh ? sh.getRange('B2').getValue() : 'DESCONHECIDO';

    if (!ultimaExec) {
      notificarErroOperacional_('Healthcheck: nenhuma execução registrada no STATUS_SISTEMA.');
      registrarLogSistema_('WARN', 'HEALTHCHECK', 'Nenhuma execução registrada no STATUS_SISTEMA');
      return;
    }

    const minsSemExec = Math.round((new Date() - new Date(ultimaExec)) / 60000);
    if (status !== 'OK' || minsSemExec > AUTO_OPS.PROCESS_INTERVAL_MIN * 4) {
      notificarErroOperacional_(`Healthcheck: status=${status}, última execução há ${minsSemExec} min.`);
      registrarLogSistema_('WARN', 'HEALTHCHECK', `Status=${status}; última execução há ${minsSemExec} min`);
      return;
    }

    registrarLogSistema_('INFO', 'HEALTHCHECK', `Sistema saudável. Última execução há ${minsSemExec} min`);
  } catch (err) {
    registrarLogSistema_('ERROR', 'HEALTHCHECK', err.message, String(err.stack || ''));
    notificarErroOperacional_(`Falha no healthcheck: ${err.message}`);
  }
}

function exportarParaGitHubSeguro_() {
  const jsonText = buildTrocasJSON();
  const json = JSON.parse(jsonText);
  const totalAtual = Number(json.total || 0);
  const atualNoGithub = obterTrocasJsonAtualGitHub_();
  const totalGithub = atualNoGithub ? Number(atualNoGithub.total || 0) : 0;

  if (totalAtual < AUTO_OPS.MIN_EXPECTED_RECORDS && totalGithub > totalAtual) {
    const motivo = `Exportação bloqueada para evitar sobrescrita com JSON vazio/quase vazio. Atual=${totalAtual}, GitHub=${totalGithub}`;
    registrarLogSistema_('WARN', 'EXPORT_JSON', motivo);
    atualizarStatusSistema_('WARN', totalAtual, 0, motivo);
    notificarErroOperacional_(motivo);
    return false;
  }

  exportarParaGitHub();
  registrarLogSistema_('INFO', 'EXPORT_JSON', `Exportação concluída com ${totalAtual} registros`);
  return true;
}

function obterTrocasJsonAtualGitHub_() {
  const ghToken = getProp(PROP.GH_TOKEN, '');
  const ghRepo = getProp(PROP.GH_REPO, '');
  const ghBranch = getProp(PROP.GH_BRANCH, 'main');
  if (!ghToken || !ghRepo) return null;

  const url = `https://api.github.com/repos/${ghRepo}/contents/site/data/trocas.json?ref=${ghBranch}`;
  try {
    const resp = UrlFetchApp.fetch(url, {
      headers: {
        'Authorization': `token ${ghToken}`,
        'User-Agent': 'TrocaPostes-AutoOps',
        'Accept': 'application/vnd.github+json'
      },
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) return null;
    const payload = JSON.parse(resp.getContentText());
    if (!payload.content) return null;
    const decoded = Utilities.newBlob(Utilities.base64Decode(payload.content.replace(/\n/g, ''))).getDataAsString('UTF-8');
    return JSON.parse(decoded);
  } catch (err) {
    registrarLogSistema_('WARN', 'EXPORT_JSON', `Não foi possível ler o trocas.json atual do GitHub: ${err.message}`);
    return null;
  }
}

function contarTrocasAtuais_() {
  const ss = getSpreadsheet();
  const sh = ss.getSheetByName(SHEET.TROCAS);
  if (!sh || sh.getLastRow() < 2) return 0;
  const ids = sh.getRange(2, COL.ID + 1, sh.getLastRow() - 1, 1).getValues().flat().filter(Boolean);
  return ids.length;
}

function garantirAbasOperacionais_() {
  const ss = getSpreadsheet();

  const shLog = getOrCreateSheet(ss, SHEET.LOG_SISTEMA);
  if (shLog.getLastRow() === 0) {
    shLog.appendRow(['DATA_HORA', 'NIVEL', 'ORIGEM', 'MENSAGEM', 'DETALHE']);
  }

  const shStatus = getOrCreateSheet(ss, SHEET.STATUS_SISTEMA);
  if (shStatus.getLastRow() === 0) {
    shStatus.appendRow(['ULTIMA_EXECUCAO', 'STATUS', 'TOTAL_TROCAS', 'DURACAO_MS', 'MENSAGEM']);
  }
}

function registrarLogSistema_(nivel, origem, mensagem, detalhe) {
  const ss = getSpreadsheet();
  const sh = getOrCreateSheet(ss, SHEET.LOG_SISTEMA);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['DATA_HORA', 'NIVEL', 'ORIGEM', 'MENSAGEM', 'DETALHE']);
  }
  sh.appendRow([new Date(), nivel, origem, mensagem, detalhe || '']);
  Logger.log(`[${nivel}] [${origem}] ${mensagem}`);
}

function atualizarStatusSistema_(status, totalTrocas, duracaoMs, mensagem) {
  const ss = getSpreadsheet();
  const sh = getOrCreateSheet(ss, SHEET.STATUS_SISTEMA);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['ULTIMA_EXECUCAO', 'STATUS', 'TOTAL_TROCAS', 'DURACAO_MS', 'MENSAGEM']);
  }
  sh.getRange('A2:E2').setValues([[new Date(), status, Number(totalTrocas || 0), Number(duracaoMs || 0), mensagem || '']]);
}

function notificarErroOperacional_(mensagem) {
  try {
    const token = getProp(PROP.TELEGRAM_TOKEN, '');
    const chatId = getProp(PROP.TELEGRAM_CHATID, '');
    if (!token || !chatId) return false;

    const texto = [
      '🚨 *TROCA-POSTES — ALERTA AUTOMÁTICO*',
      '',
      `🕒 ${Utilities.formatDate(new Date(), AUTO_OPS.TZ, 'dd/MM/yyyy HH:mm:ss')}`,
      `⚠️ ${mensagem}`
    ].join('\n');

    return sendTelegramMessage(token, chatId, texto);
  } catch (err) {
    Logger.log(`[ERROR] [ALERTA_AUTO] ${err.message}`);
    return false;
  }
}
