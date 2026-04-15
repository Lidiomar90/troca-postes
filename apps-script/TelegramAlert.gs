// ============================================================
// TelegramAlert.gs — Envio de alertas via Telegram Bot API
// D-1: alerta na véspera da troca (23:00 do dia anterior)
// D0:  alerta no dia da troca (07:00)
// Idempotente: não reenvia se já houver timestamp na coluna
// ============================================================

/**
 * Verifica todas as trocas e envia alertas conforme timing.
 * Chamado pelo trigger: todos os dias às 07:00 e 23:00.
 */
function verificarEEnviarAlertas() {
  const ss = getSpreadsheet();
  const sh = ss.getSheetByName(SHEET.TROCAS);
  if (!sh) return;

  let token, chatId;
  try {
    token  = getProp(PROP.TELEGRAM_TOKEN);
    chatId = getProp(PROP.TELEGRAM_CHATID);
  } catch (e) {
    Logger.log('[Telegram] Token/ChatID não configurados. Configure nas Script Properties.');
    return;
  }

  const data = sh.getDataRange().getValues();
  let enviados = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const status = String(row[COL.STATUS] || '').toUpperCase();

    // Só alertas para ordens ativas
    if (status === 'CANCELADO' || status === 'EXECUTADO') continue;

    const dias = diasAte(row[COL.DATA_TROCA]);
    if (dias === null) continue;

    // ── Alerta D-1 ────────────────────────────────────────────
    if (dias === 1 && !row[COL.ALERTA_D1_SENT]) {
      const msg = buildMsgD1(row);
      if (sendTelegramMessage(token, chatId, msg)) {
        sh.getRange(i+1, COL.ALERTA_D1_SENT+1).setValue(new Date().toISOString());
        data[i][COL.ALERTA_D1_SENT] = true; // evita re-envio no mesmo loop
        enviados++;
        Logger.log(`[Telegram] D-1 enviado: ID ${row[COL.ID]}`);
      }
    }

    // ── Alerta D0 ─────────────────────────────────────────────
    if (dias === 0 && !row[COL.ALERTA_D0_SENT]) {
      const msg = buildMsgD0(row);
      if (sendTelegramMessage(token, chatId, msg)) {
        sh.getRange(i+1, COL.ALERTA_D0_SENT+1).setValue(new Date().toISOString());
        data[i][COL.ALERTA_D0_SENT] = true;
        enviados++;
        Logger.log(`[Telegram] D0 enviado: ID ${row[COL.ID]}`);
      }
    }

    // ── Log em FILA_REVISAO se sem coords após D-1 ────────────
    if (dias <= 1 && row[COL.GEO_STATUS] !== 'OK') {
      adicionarFilaRevisao(ss, row, 'SEM_GEOCODING_CRITICO');
    }
  }

  const resumo = `[Telegram] Rodada concluída: ${enviados} alertas enviados`;
  Logger.log(resumo);
  logExecucao('VERIFICAR_ALERTAS', resumo);
  logAlerta('RODADA', resumo, enviados);
}

// ── Construtores de mensagem ──────────────────────────────────

function buildMsgD1(row) {
  const redeEmoji = redeStatusEmoji(row[COL.REDE_STATUS]);
  return [
    `⚠️ *TROCA DE POSTE — AMANHÃ* ⚠️`,
    ``,
    `📋 *ID:* ${row[COL.ID]}`,
    `📅 *Data:* ${fmtDate(row[COL.DATA_TROCA])}`,
    `📍 *Endereço:*`,
    `${row[COL.LOGRADOURO]}, ${row[COL.NUMERO]}`,
    `${row[COL.BAIRRO]} — ${row[COL.CIDADE]}/${row[COL.UF]}`,
    ``,
    `🔧 *Poste:* ${row[COL.TIPO_POSTE_OLD] || '—'} → ${row[COL.TIPO_POSTE_NEW] || '—'}`,
    `👤 *Responsável:* ${row[COL.RESPONSAVEL] || '—'}`,
    ``,
    `${redeEmoji} *Rede próxima:* ${row[COL.REDE_STATUS] || 'N/A'} (${row[COL.REDE_DIST_M] ? row[COL.REDE_DIST_M]+'m' : '—'})`,
    row[COL.OBS] ? `💬 *Obs:* ${row[COL.OBS]}` : '',
  ].filter(l => l !== null && l !== undefined).join('\n');
}

function buildMsgD0(row) {
  const redeEmoji = redeStatusEmoji(row[COL.REDE_STATUS]);
  const coordsLink = (row[COL.LAT] && row[COL.LNG])
    ? `\n🗺️ [Ver no mapa](https://maps.google.com/?q=${row[COL.LAT]},${row[COL.LNG]})`
    : '';
  return [
    `🔴 *TROCA DE POSTE — HOJE* 🔴`,
    ``,
    `📋 *ID:* ${row[COL.ID]}`,
    `📅 *Data:* ${fmtDate(row[COL.DATA_TROCA])}`,
    `📍 *Endereço:*`,
    `${row[COL.LOGRADOURO]}, ${row[COL.NUMERO]}`,
    `${row[COL.BAIRRO]} — ${row[COL.CIDADE]}/${row[COL.UF]}`,
    coordsLink,
    ``,
    `🔧 *Poste:* ${row[COL.TIPO_POSTE_OLD] || '—'} → ${row[COL.TIPO_POSTE_NEW] || '—'}`,
    `👤 *Responsável:* ${row[COL.RESPONSAVEL] || '—'}`,
    ``,
    `${redeEmoji} *Rede próxima:* ${row[COL.REDE_STATUS] || 'N/A'} (${row[COL.REDE_DIST_M] ? row[COL.REDE_DIST_M]+'m' : '—'})`,
    row[COL.OBS] ? `💬 *Obs:* ${row[COL.OBS]}` : '',
    ``,
    `ℹ️ Atualize o status para EXECUTADO após a conclusão.`,
  ].filter(l => l !== null && l !== undefined).join('\n');
}

function redeStatusEmoji(status) {
  if (!status) return '⚪';
  if (status === 'REDE PRÓXIMA') return '🟢';
  if (status === 'ATENÇÃO')      return '🟡';
  if (status === 'SEM REDE')     return '🔴';
  return '⚪';
}

// ── Envio HTTP para Telegram Bot API ─────────────────────────

function sendTelegramMessage(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'Markdown',
    disable_web_page_preview: false
  };
  try {
    const resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = resp.getResponseCode();
    if (code === 200) return true;
    Logger.log(`[Telegram] Erro ${code}: ${resp.getContentText()}`);
    return false;
  } catch (e) {
    Logger.log(`[Telegram] Exceção: ${e.message}`);
    return false;
  }
}

// ── Teste manual do Telegram ──────────────────────────────────

function testarTelegram() {
  let token, chatId;
  try {
    token  = getProp(PROP.TELEGRAM_TOKEN);
    chatId = getProp(PROP.TELEGRAM_CHATID);
  } catch (e) {
    Logger.log('[Telegram] Configure TELEGRAM_TOKEN e TELEGRAM_CHAT_ID nas Script Properties');
    return;
  }
  const ok = sendTelegramMessage(token, chatId,
    '✅ *Teste TROCA-POSTES*\n\nBot configurado e funcionando!\n' +
    `Hora: ${new Date().toLocaleString('pt-BR', {timeZone:'America/Sao_Paulo'})}`
  );
  Logger.log(ok ? '[Telegram] Teste enviado com sucesso!' : '[Telegram] Falha no teste');
}

// ── Fila de revisão manual ────────────────────────────────────

function adicionarFilaRevisao(ss, rowData, motivo) {
  const sh = getOrCreateSheet(ss, SHEET.FILA_REVISAO);
  if (sh.getLastRow() === 0) {
    sh.getRange(1,1,1,5).setValues([['ID','DATA_TROCA','ENDERECO','MOTIVO','ADICIONADO_EM']]);
  }
  const addr = `${rowData[COL.LOGRADOURO]}, ${rowData[COL.NUMERO]} - ${rowData[COL.CIDADE]}`;
  // Idempotente: só adiciona se ID não existe
  const existingIds = sh.getLastRow() > 1
    ? sh.getRange(2,1,sh.getLastRow()-1,1).getValues().map(r=>String(r[0]))
    : [];
  if (!existingIds.includes(String(rowData[COL.ID]))) {
    sh.appendRow([rowData[COL.ID], fmtDate(rowData[COL.DATA_TROCA]), addr, motivo, new Date()]);
  }
}
