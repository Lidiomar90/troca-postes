// ============================================================
// Diagnostico.gs — Validação completa do sistema TROCA-POSTES
// Verifica: Script Properties, Telegram, GitHub, planilha,
// geocoding, network check e export.
// Execute via menu: 🔧 TROCA-POSTES > Diagnóstico completo
// ============================================================

/**
 * Executa todos os checks e gera relatório na aba LOG_EXECUCAO.
 */
function diagnosticoCompleto() {
  const ss = getSpreadsheet();
  const ui = getSpreadsheetUiSafe();
  const resultados = [];
  let erros = 0;

  // ── Check 1: Script Properties obrigatórias ───────────────
  const propsObrigatorias = [
    PROP.TELEGRAM_TOKEN,
    PROP.TELEGRAM_CHATID,
    PROP.GH_TOKEN,
    PROP.GH_REPO,
    PROP.GH_BRANCH,
  ];

  propsObrigatorias.forEach(key => {
    const val = PropertiesService.getScriptProperties().getProperty(key);
    if (val && String(val).trim()) {
      resultados.push(['OK', `Script Property "${key}" configurada`]);
    } else {
      resultados.push(['ERRO', `Script Property "${key}" NÃO configurada`]);
      erros++;
    }
  });

  // ── Check 2: Abas existem ─────────────────────────────────
  const abasObrigatorias = [
    SHEET.TROCAS,
    SHEET.CONFIG,
    SHEET.BASE_REDE,
    SHEET.LOG_EXECUCAO,
    SHEET.LOG_ALERTAS,
    SHEET.FILA_REVISAO
  ];

  abasObrigatorias.forEach(nome => {
    const sh = ss.getSheetByName(nome);
    if (sh) {
      resultados.push(['OK', `Aba "${nome}" existe (${Math.max(0, sh.getLastRow() - 1)} linhas)`]);
    } else {
      resultados.push(['AVISO', `Aba "${nome}" não encontrada — execute inicializarPlanilha()`]);
      erros++;
    }
  });

  // ── Check 3: Aba TROCAS tem dados ────────────────────────
  const shTrocas = ss.getSheetByName(SHEET.TROCAS);
  if (shTrocas && shTrocas.getLastRow() > 1) {
    const totalLinhas = shTrocas.getLastRow() - 1;
    const dados = shTrocas.getDataRange().getValues().slice(1);

    const semGeo = dados.filter(r =>
      String(r[COL.GEO_STATUS] || '').trim() !== 'OK' &&
      String(r[COL.STATUS] || '').trim().toUpperCase() !== 'CANCELADO'
    ).length;

    const semRede = dados.filter(r =>
      !r[COL.REDE_STATUS] &&
      String(r[COL.GEO_STATUS] || '').trim() === 'OK'
    ).length;

    resultados.push(['OK', `TROCAS: ${totalLinhas} registros, ${semGeo} sem geocoding, ${semRede} sem verificação de rede`]);
  } else {
    resultados.push(['AVISO', 'Aba TROCAS está vazia. Importe os dados da planilha operacional.']);
  }

  // ── Check 4: BASE_REDE tem dados ─────────────────────────
  const shRede = ss.getSheetByName(SHEET.BASE_REDE);
  if (shRede && shRede.getLastRow() > 1) {
    resultados.push(['OK', `BASE_REDE: ${shRede.getLastRow() - 1} nós carregados`]);
  } else {
    resultados.push(['AVISO', 'BASE_REDE vazia — execute importarBaseRedeSupabase() ou cole os dados manualmente']);
  }

  // ── Check 5: Telegram ─────────────────────────────────────
  try {
    const token = getProp(PROP.TELEGRAM_TOKEN);
    const url = `https://api.telegram.org/bot${token}/getMe`;
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });

    if (resp.getResponseCode() === 200) {
      const bot = JSON.parse(resp.getContentText());
      resultados.push(['OK', `Telegram: bot "@${bot.result.username}" autenticado`]);
    } else {
      resultados.push(['ERRO', `Telegram: token inválido (HTTP ${resp.getResponseCode()})`]);
      erros++;
    }
  } catch (e) {
    resultados.push(['ERRO', `Telegram: ${e.message}`]);
    erros++;
  }

  // ── Check 6: GitHub API ───────────────────────────────────
  try {
    const ghToken = getProp(PROP.GH_TOKEN);
    const ghRepo = getProp(PROP.GH_REPO);
    const url = `https://api.github.com/repos/${ghRepo}`;

    const resp = UrlFetchApp.fetch(url, {
      headers: {
        'Authorization': `token ${ghToken}`,
        'User-Agent': 'TrocaPostes'
      },
      muteHttpExceptions: true
    });

    if (resp.getResponseCode() === 200) {
      const repo = JSON.parse(resp.getContentText());
      resultados.push(['OK', `GitHub: repositório "${ghRepo}" acessível (${repo.visibility || 'visibilidade não informada'})`]);
    } else {
      resultados.push(['ERRO', `GitHub: repo "${ghRepo}" não acessível (HTTP ${resp.getResponseCode()})`]);
      erros++;
    }
  } catch (e) {
    resultados.push(['ERRO', `GitHub: ${e.message}`]);
    erros++;
  }

  // ── Check 7: Triggers ativos ──────────────────────────────
  try {
    const triggers = ScriptApp.getProjectTriggers();
    const triggerNames = triggers.map(t => t.getHandlerFunction());
    const esperados = ['processarTudo', 'verificarEEnviarAlertas'];

    esperados.forEach(fn => {
      if (triggerNames.includes(fn)) {
        resultados.push(['OK', `Trigger "${fn}" configurado`]);
      } else {
        resultados.push(['AVISO', `Trigger "${fn}" NÃO configurado — execute configurarTriggers()`]);
      }
    });
  } catch (e) {
    resultados.push(['AVISO', `Não foi possível validar triggers: ${e.message}`]);
  }

  // ── Check 8: Geocoding de teste ───────────────────────────
  try {
    const geocoder = Maps.newGeocoder().setRegion('br');
    const testAddr = 'Av. Afonso Pena, 1500, Belo Horizonte, MG, Brasil';
    const testResp = geocoder.geocode(testAddr);

    if (testResp.status === 'OK' && testResp.results && testResp.results.length) {
      const loc = testResp.results[0].geometry.location;
      resultados.push(['OK', `Google Maps Geocoding OK: ${testAddr} → ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`]);
    } else {
      resultados.push(['AVISO', `Geocoding retornou status: ${testResp.status}`]);
    }
  } catch (e) {
    resultados.push(['AVISO', `Geocoding: ${e.message} (pode ser quota)`]);
  }

  // ── Check 9: trocas.json acessível no GitHub Pages ────────
  try {
    const ghRepo = getProp(PROP.GH_REPO);
    const owner = ghRepo.split('/')[0].toLowerCase();
    const repo = ghRepo.split('/')[1];
    const jsonUrl = `https://${owner}.github.io/${repo}/site/data/trocas.json`;

    const resp = UrlFetchApp.fetch(jsonUrl, { muteHttpExceptions: true });

    if (resp.getResponseCode() === 200) {
      const j = JSON.parse(resp.getContentText());
      resultados.push(['OK', `GitHub Pages: trocas.json acessível (${j.total || 0} registros, gerado em ${j.gerado_em || '?'})`]);
    } else {
      resultados.push(['AVISO', `GitHub Pages: trocas.json retornou HTTP ${resp.getResponseCode()} — aguarde ~2min após o primeiro push`]);
    }
  } catch (e) {
    resultados.push(['AVISO', `GitHub Pages não acessível ainda: ${e.message}`]);
  }

  // ── Gera relatório ────────────────────────────────────────
  const totalOk = resultados.filter(r => r[0] === 'OK').length;
  const totalAviso = resultados.filter(r => r[0] === 'AVISO').length;
  const totalErro = resultados.filter(r => r[0] === 'ERRO').length;

  const shLog = getOrCreateSheet(ss, SHEET.LOG_EXECUCAO);
  resultados.forEach(r => {
    shLog.appendRow([new Date(), 'DIAGNOSTICO', r[1], r[0]]);
  });

  shLog.appendRow([
    new Date(),
    'DIAGNOSTICO',
    `RESUMO: ${totalOk} OK, ${totalAviso} AVISO, ${totalErro} ERRO`,
    totalErro > 0 ? 'ERRO' : totalAviso > 0 ? 'AVISO' : 'OK'
  ]);

  const lastRow = shLog.getLastRow();
  if (totalErro > 0) {
    const erroRows = resultados.reduce((acc, r, i) => {
      if (r[0] === 'ERRO') acc.push(lastRow - resultados.length + i);
      return acc;
    }, []);

    erroRows.forEach(row => {
      shLog.getRange(row, 1, 1, 4).setBackground('#3a0a0a');
    });
  }

  const icon = totalErro > 0 ? '🔴' : totalAviso > 0 ? '🟡' : '🟢';
  const summary =
    `${icon} Diagnóstico concluído\n\n` +
    `✅ OK: ${totalOk}\n` +
    `⚠️ Avisos: ${totalAviso}\n` +
    `❌ Erros: ${totalErro}\n\n` +
    (totalErro > 0
      ? 'ERROS ENCONTRADOS:\n' + resultados.filter(r => r[0] === 'ERRO').map(r => '• ' + r[1]).join('\n')
      : '') +
    '\n\nVeja detalhes na aba LOG_EXECUCAO.';

  if (ui) {
    ui.alert('Diagnóstico TROCA-POSTES', summary, ui.ButtonSet.OK);
  }

  Logger.log('[Diagnostico] ' + summary);
  return {
    ok: totalErro === 0,
    totalOk: totalOk,
    totalAviso: totalAviso,
    totalErro: totalErro,
    resultados: resultados
  };
}

/**
 * Diagnóstico rápido (só erros críticos, sem UI).
 * Chamado automaticamente no início do processarTudo().
 */
function diagnosticoRapido() {
  const props = PropertiesService.getScriptProperties();
  const erros = [];

  [PROP.TELEGRAM_TOKEN, PROP.TELEGRAM_CHATID].forEach(k => {
    if (!props.getProperty(k)) {
      erros.push(`Script Property ausente: ${k}`);
    }
  });

  const ss = getSpreadsheet();
  if (!ss.getSheetByName(SHEET.TROCAS)) {
    erros.push('Aba TROCAS não existe');
  }

  if (erros.length > 0) {
    Logger.log('[Diagnostico] AVISOS:\n' + erros.join('\n'));
  }

  return erros;
}

/**
 * Tenta obter a UI da planilha sem quebrar a execução.
 */
function getSpreadsheetUiSafe() {
  try {
    return SpreadsheetApp.getUi();
  } catch (e) {
    Logger.log('[Diagnostico] UI indisponível neste contexto: ' + e.message);
    return null;
  }
} 