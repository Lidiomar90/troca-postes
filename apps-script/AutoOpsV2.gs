// ============================================================
// AutoOpsV2.gs — Versão profissional do fluxo automático
// Controle de quota Google Maps, fallback Nominatim, logs,
// proteção de exportação e auto-recuperação operacional.
// ============================================================

const AUTO_OPS_V2 = {
  TZ: 'America/Sao_Paulo',
  PROCESS_INTERVAL_MIN: 15,
  HEALTH_HOUR: 8,
  GEOCODE_LIMIT_PER_RUN: 15,
  NOMINATIM_DELAY_MS: 1200,
  GOOGLE_BLOCK_HOURS: 12,
  MIN_EXPECTED_RECORDS: 1,
  PROP_GOOGLE_BLOCKED_UNTIL: 'GEOCODER_GOOGLE_BLOCKED_UNTIL',
  LOG_SHEET: 'LOG_SISTEMA',
  STATUS_SHEET: 'STATUS_SISTEMA',
};

function processarTudoAutomaticoV2() {
  const inicio = new Date();
  let totalTrocas = 0;

  try {
    garantirAbasOperacionaisV2_();
    registrarLogSistemaV2_('INFO', 'AUTO_V2', 'Início');

    const geoResumo = geocodificarPendentesControladoV2_(AUTO_OPS_V2.GEOCODE_LIMIT_PER_RUN);
    registrarLogSistemaV2_('INFO', 'GEOCODER_V2', geoResumo);

    try {
      verificarProximidadeTodas();
    } catch (errRede) {
      registrarLogSistemaV2_('WARN', 'NETWORKCHECK_V2', errRede.message, String(errRede.stack || ''));
    }

    try {
      verificarEEnviarAlertas();
    } catch (errAlert) {
      registrarLogSistemaV2_('WARN', 'ALERTAS_V2', errAlert.message, String(errAlert.stack || ''));
      notificarErroOperacionalV2_('Falha na rotina de alertas: ' + errAlert.message);
    }

    totalTrocas = contarTrocasAtuaisV2_();

    const exportou = exportarParaGitHubSeguroV2_();

    try {
      enviarNovasTrocasParaSupabase();
    } catch (supErr) {
      registrarLogSistemaV2_('WARN', 'SUPABASE_SYNC_V2', supErr.message, String(supErr.stack || ''));
    }

    try {
      atualizarProcEm();
    } catch (procErr) {
      registrarLogSistemaV2_('WARN', 'PROC_EM_V2', procErr.message, String(procErr.stack || ''));
    }

    const duracaoMs = new Date() - inicio;
    const msg = 'Concluído. Total=' + totalTrocas + '; export=' + (exportou ? 'OK' : 'BLOQUEADO') + '; duração=' + duracaoMs + ' ms';
    atualizarStatusSistemaV2_('OK', totalTrocas, duracaoMs, msg);
    registrarLogSistemaV2_('INFO', 'AUTO_V2', 'Concluído');
    return true;
  } catch (err) {
    const duracaoMs = new Date() - inicio;
    atualizarStatusSistemaV2_('ERRO', totalTrocas, duracaoMs, err.message);
    registrarLogSistemaV2_('ERROR', 'AUTO_V2', err.message, String(err.stack || ''));
    notificarErroOperacionalV2_('Falha no processamento automático V2: ' + err.message);
    throw err;
  }
}

function configurarTriggersAutomaticosV2() {
  removerTriggersAutomaticosV2_();

  ScriptApp.newTrigger('processarTudoAutomaticoV2')
    .timeBased()
    .everyMinutes(AUTO_OPS_V2.PROCESS_INTERVAL_MIN)
    .create();

  ScriptApp.newTrigger('verificarSaudeSistemaV2_')
    .timeBased()
    .everyDays(1)
    .atHour(AUTO_OPS_V2.HEALTH_HOUR)
    .inTimezone(AUTO_OPS_V2.TZ)
    .create();

  registrarLogSistemaV2_('INFO', 'TRIGGER_SETUP_V2', 'Triggers V2 configurados');
  return true;
}

function removerTriggersAutomaticosV2_() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    const fn = t.getHandlerFunction();
    if (['processarTudoAutomaticoV2', 'verificarSaudeSistemaV2_', 'processarTudoAutomatico', 'verificarSaudeSistema_'].indexOf(fn) !== -1) {
      ScriptApp.deleteTrigger(t);
    }
  });
}

function verificarSaudeSistemaV2_() {
  try {
    garantirAbasOperacionaisV2_();
    const ss = getSpreadsheet();
    const sh = ss.getSheetByName(AUTO_OPS_V2.STATUS_SHEET);
    const ultimaExec = sh ? sh.getRange('A2').getValue() : null;
    const status = sh ? sh.getRange('B2').getValue() : 'DESCONHECIDO';

    if (!ultimaExec) {
      registrarLogSistemaV2_('WARN', 'HEALTHCHECK_V2', 'Nenhuma execução registrada');
      notificarErroOperacionalV2_('Healthcheck V2: nenhuma execução registrada em STATUS_SISTEMA.');
      return;
    }

    const minsSemExec = Math.round((new Date() - new Date(ultimaExec)) / 60000);
    if (status !== 'OK' || minsSemExec > AUTO_OPS_V2.PROCESS_INTERVAL_MIN * 4) {
      registrarLogSistemaV2_('WARN', 'HEALTHCHECK_V2', 'Status=' + status + '; última execução há ' + minsSemExec + ' min');
      notificarErroOperacionalV2_('Healthcheck V2: status=' + status + ', última execução há ' + minsSemExec + ' min.');
      return;
    }

    registrarLogSistemaV2_('INFO', 'HEALTHCHECK_V2', 'Sistema saudável');
  } catch (err) {
    registrarLogSistemaV2_('ERROR', 'HEALTHCHECK_V2', err.message, String(err.stack || ''));
    notificarErroOperacionalV2_('Falha no healthcheck V2: ' + err.message);
  }
}

function geocodificarPendentesControladoV2_(limite) {
  const ss = getSpreadsheet();
  const sh = ss.getSheetByName(SHEET.TROCAS);
  if (!sh) throw new Error('Aba TROCAS não encontrada');

  const data = sh.getDataRange().getValues();
  const cache = CacheService.getScriptCache();
  let ok = 0, fail = 0, skip = 0, tentados = 0;
  let googleBloqueadoAgora = isGoogleGeocoderBlockedV2_();

  for (let i = 1; i < data.length; i++) {
    if (tentados >= limite) break;

    const row = data[i];
    const status = String(row[COL.STATUS] || '').toUpperCase();
    const hasCoords = !!row[COL.LAT] && !!row[COL.LNG];
    const geoStatus = String(row[COL.GEO_STATUS] || '');

    if (status === 'CANCELADO' || status === 'EXECUTADO') { skip++; continue; }
    if (hasCoords && geoStatus === 'OK') { skip++; continue; }

    const addr = buildAddress(row);
    if (!addr) {
      setCellValue(sh, i + 1, COL.GEO_STATUS, 'SEM_ENDERECO');
      skip++;
      continue;
    }

    tentados++;
    const cacheKey = 'geo:' + addr.toLowerCase().trim();
    const cached = cache.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      setCellValue(sh, i + 1, COL.LAT, parsed.lat);
      setCellValue(sh, i + 1, COL.LNG, parsed.lng);
      setCellValue(sh, i + 1, COL.GEO_STATUS, 'OK');
      ok++;
      continue;
    }

    let result = null;

    if (!googleBloqueadoAgora) {
      const googleTry = geocodeGoogleMapsSafeV2_(addr);
      if (googleTry && googleTry.blocked) {
        googleBloqueadoAgora = true;
        bloquearGoogleGeocoderV2_();
        registrarLogSistemaV2_('WARN', 'GEOCODER_V2', 'Quota do Google atingida. Fallback para Nominatim ativado.');
      } else if (googleTry && googleTry.lat && googleTry.lng) {
        result = { lat: googleTry.lat, lng: googleTry.lng };
      }
    }

    if (!result) {
      result = geocodeNominatimSafeV2_(addr);
    }

    if (result && result.lat && result.lng) {
      setCellValue(sh, i + 1, COL.LAT, result.lat);
      setCellValue(sh, i + 1, COL.LNG, result.lng);
      setCellValue(sh, i + 1, COL.GEO_STATUS, 'OK');
      cache.put(cacheKey, JSON.stringify(result), 21600);
      ok++;
    } else {
      setCellValue(sh, i + 1, COL.GEO_STATUS, 'FALHOU');
      fail++;
    }
  }

  return 'Geocoding controlado concluído: ' + ok + ' OK, ' + fail + ' falhou, ' + skip + ' pulados, ' + tentados + ' tentados (limite=' + limite + ')';
}

function geocodeGoogleMapsSafeV2_(address) {
  if (isGoogleGeocoderBlockedV2_()) {
    return { blocked: true };
  }

  try {
    if (typeof geocodeGoogleMaps === 'function') {
      const result = geocodeGoogleMaps(address);
      if (result && result.lat && result.lng) return result;
      return null;
    }

    const geocoder = Maps.newGeocoder().setRegion('br');
    const response = geocoder.geocode(address);
    if (response.status === 'OK' && response.results && response.results.length > 0) {
      const loc = response.results[0].geometry.location;
      return { lat: loc.lat, lng: loc.lng };
    }
    return null;
  } catch (e) {
    const msg = String(e.message || e);
    if (msg.indexOf('too many times for one day') !== -1 || msg.indexOf('Service invoked too many times') !== -1) {
      return { blocked: true };
    }
    Logger.log('[GeocoderV2] Google Maps erro: ' + msg);
    return null;
  }
}

function geocodeNominatimSafeV2_(address) {
  try {
    if (typeof geocodeNominatim === 'function') {
      const result = geocodeNominatim(address);
      if (result && result.lat && result.lng) return result;
      Utilities.sleep(AUTO_OPS_V2.NOMINATIM_DELAY_MS);
      return null;
    }

    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(address);
    const resp = UrlFetchApp.fetch(url, {
      headers: { 'User-Agent': 'TrocaPostes/1.0 (lidiomar90@gmail.com)' },
      muteHttpExceptions: true
    });
    Utilities.sleep(AUTO_OPS_V2.NOMINATIM_DELAY_MS);
    if (resp.getResponseCode() === 200) {
      const data = JSON.parse(resp.getContentText());
      if (data && data.length > 0) {
        return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      }
    }
  } catch (e) {
    Logger.log('[GeocoderV2] Nominatim erro: ' + e.message);
  }
  return null;
}

function isGoogleGeocoderBlockedV2_() {
  const until = PropertiesService.getScriptProperties().getProperty(AUTO_OPS_V2.PROP_GOOGLE_BLOCKED_UNTIL);
  return !!until && new Date(until).getTime() > Date.now();
}

function bloquearGoogleGeocoderV2_() {
  const until = new Date(Date.now() + AUTO_OPS_V2.GOOGLE_BLOCK_HOURS * 60 * 60 * 1000).toISOString();
  PropertiesService.getScriptProperties().setProperty(AUTO_OPS_V2.PROP_GOOGLE_BLOCKED_UNTIL, until);
}

function exportarParaGitHubSeguroV2_() {
  const jsonText = buildTrocasJSON();
  const json = JSON.parse(jsonText);
  const totalAtual = Number(json.total || 0);
  const atualNoGithub = obterTrocasJsonAtualGitHubV2_();
  const totalGithub = atualNoGithub ? Number(atualNoGithub.total || 0) : 0;

  if (totalAtual < AUTO_OPS_V2.MIN_EXPECTED_RECORDS && totalGithub > totalAtual) {
    const motivo = 'Exportação bloqueada para evitar sobrescrita com JSON vazio/quase vazio. Atual=' + totalAtual + ', GitHub=' + totalGithub;
    registrarLogSistemaV2_('WARN', 'EXPORT_JSON_V2', motivo);
    atualizarStatusSistemaV2_('WARN', totalAtual, 0, motivo);
    notificarErroOperacionalV2_(motivo);
    return false;
  }

  exportarParaGitHub();
  registrarLogSistemaV2_('INFO', 'EXPORT_JSON_V2', 'Exportação concluída com ' + totalAtual + ' registros');
  return true;
}

function obterTrocasJsonAtualGitHubV2_() {
  const ghToken = getProp(PROP.GH_TOKEN, '');
  const ghRepo = getProp(PROP.GH_REPO, '');
  const ghBranch = getProp(PROP.GH_BRANCH, 'main');
  if (!ghToken || !ghRepo) return null;

  const url = 'https://api.github.com/repos/' + ghRepo + '/contents/site/data/trocas.json?ref=' + ghBranch;
  try {
    const resp = UrlFetchApp.fetch(url, {
      headers: {
        'Authorization': 'token ' + ghToken,
        'User-Agent': 'TrocaPostes-AutoOpsV2',
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
    registrarLogSistemaV2_('WARN', 'EXPORT_JSON_V2', 'Não foi possível ler o trocas.json atual do GitHub: ' + err.message);
    return null;
  }
}

function contarTrocasAtuaisV2_() {
  const ss = getSpreadsheet();
  const sh = ss.getSheetByName(SHEET.TROCAS);
  if (!sh || sh.getLastRow() < 2) return 0;
  return sh.getRange(2, COL.ID + 1, sh.getLastRow() - 1, 1).getValues().flat().filter(Boolean).length;
}

function garantirAbasOperacionaisV2_() {
  const ss = getSpreadsheet();
  const shLog = getOrCreateSheet(ss, AUTO_OPS_V2.LOG_SHEET);
  if (shLog.getLastRow() === 0) {
    shLog.appendRow(['DATA_HORA', 'NIVEL', 'ORIGEM', 'MENSAGEM', 'DETALHE']);
  }
  const shStatus = getOrCreateSheet(ss, AUTO_OPS_V2.STATUS_SHEET);
  if (shStatus.getLastRow() === 0) {
    shStatus.appendRow(['ULTIMA_EXECUCAO', 'STATUS', 'TOTAL_TROCAS', 'DURACAO_MS', 'MENSAGEM']);
  }
}

function registrarLogSistemaV2_(nivel, origem, mensagem, detalhe) {
  const ss = getSpreadsheet();
  const sh = getOrCreateSheet(ss, AUTO_OPS_V2.LOG_SHEET);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['DATA_HORA', 'NIVEL', 'ORIGEM', 'MENSAGEM', 'DETALHE']);
  }
  sh.appendRow([new Date(), nivel, origem, mensagem, detalhe || '']);
  Logger.log('[' + nivel + '] [' + origem + '] ' + mensagem);
}

function atualizarStatusSistemaV2_(status, totalTrocas, duracaoMs, mensagem) {
  const ss = getSpreadsheet();
  const sh = getOrCreateSheet(ss, AUTO_OPS_V2.STATUS_SHEET);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['ULTIMA_EXECUCAO', 'STATUS', 'TOTAL_TROCAS', 'DURACAO_MS', 'MENSAGEM']);
  }
  sh.getRange('A2:E2').setValues([[new Date(), status, Number(totalTrocas || 0), Number(duracaoMs || 0), mensagem || '']]);
}

function notificarErroOperacionalV2_(mensagem) {
  try {
    const token = getProp(PROP.TELEGRAM_TOKEN, '');
    const chatId = getProp(PROP.TELEGRAM_CHATID, '');
    if (!token || !chatId) return false;
    const texto = [
      '🚨 *TROCA-POSTES — ALERTA AUTOMÁTICO V2*',
      '',
      '🕒 ' + Utilities.formatDate(new Date(), AUTO_OPS_V2.TZ, 'dd/MM/yyyy HH:mm:ss'),
      '⚠️ ' + mensagem
    ].join('\n');
    return sendTelegramMessage(token, chatId, texto);
  } catch (err) {
    Logger.log('[ERROR] [ALERTA_AUTO_V2] ' + err.message);
    return false;
  }
}
