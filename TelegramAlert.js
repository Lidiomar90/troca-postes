// ============================================================
// TelegramAlert.gs — Envio de alertas via Telegram Bot API
// D-1: alerta na véspera da troca (23:00 do dia anterior)
// D0:  alerta no dia da troca (07:00)
// Idempotente: não reenvia se já houver timestamp na coluna
// Suporta 1 ou múltiplos chats em TELEGRAM_CHAT_ID
// Exemplo:
//   TELEGRAM_CHAT_ID = -1001234567890
//   TELEGRAM_CHAT_ID = -1001234567890,-1009876543210
// ============================================================

/**
 * Verifica todas as trocas e envia alertas conforme timing.
 * Chamado pelo trigger: todos os dias às 07:00 e 23:00.
 */
function verificarEEnviarAlertas() {
  const ss = getSpreadsheet();
  const sh = ss.getSheetByName(SHEET.TROCAS);
  if (!sh) {
    Logger.log('[Telegram] Aba de trocas não encontrada.');
    return;
  }

  let token, chatIdsRaw;
  try {
    token = String(getProp(PROP.TELEGRAM_TOKEN) || '').trim();
    chatIdsRaw = String(getProp(PROP.TELEGRAM_CHATID) || '').trim();
  } catch (e) {
    Logger.log('[Telegram] Token/ChatID não configurados. Configure nas Script Properties.');
    return;
  }

  if (!token) {
    Logger.log('[Telegram] TELEGRAM_TOKEN está vazio.');
    return;
  }

  const chatIds = parseTelegramChatIds(chatIdsRaw);
  if (!chatIds.length) {
    Logger.log('[Telegram] TELEGRAM_CHAT_ID inválido ou vazio.');
    return;
  }

  const data = sh.getDataRange().getValues();
  let enviados = 0;
  let falhas = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const status = String(row[COL.STATUS] || '').trim().toUpperCase();

    // Só alertas para ordens ativas
    if (status === 'CANCELADO' || status === 'EXECUTADO') continue;

    const dias = diasAte(row[COL.DATA_TROCA]);
    if (dias === null) continue;

    // ── Alerta D-1 ────────────────────────────────────────────
    if (dias === 1 && !row[COL.ALERTA_D1_SENT]) {
      const msg = buildMsgD1(row);
      const envio = sendTelegramToMany(token, chatIds, msg);

      if (envio.ok) {
        sh.getRange(i + 1, COL.ALERTA_D1_SENT + 1).setValue(new Date().toISOString());
        data[i][COL.ALERTA_D1_SENT] = true; // evita reenvio no mesmo loop
        enviados++;
        Logger.log(`[Telegram] D-1 enviado: ID ${row[COL.ID]} | chats OK: ${envio.successCount}/${envio.total}`);
      } else {
        falhas++;
        Logger.log(`[Telegram] Falha D-1: ID ${row[COL.ID]} | ${envio.summary}`);
      }
    }

    // ── Alerta D0 ─────────────────────────────────────────────
    if (dias === 0 && !row[COL.ALERTA_D0_SENT]) {
      const msg = buildMsgD0(row);
      const envio = sendTelegramToMany(token, chatIds, msg);

      if (envio.ok) {
        sh.getRange(i + 1, COL.ALERTA_D0_SENT + 1).setValue(new Date().toISOString());
        data[i][COL.ALERTA_D0_SENT] = true;
        enviados++;
        Logger.log(`[Telegram] D0 enviado: ID ${row[COL.ID]} | chats OK: ${envio.successCount}/${envio.total}`);
      } else {
        falhas++;
        Logger.log(`[Telegram] Falha D0: ID ${row[COL.ID]} | ${envio.summary}`);
      }
    }

    // ── Log em FILA_REVISAO se sem coords após D-1 ────────────
    if (dias <= 1 && String(row[COL.GEO_STATUS] || '').trim() !== 'OK') {
      adicionarFilaRevisao(ss, row, 'SEM_GEOCODING_CRITICO');
    }
  }

  const resumo = `[Telegram] Rodada concluída: ${enviados} alertas enviados, ${falhas} falhas`;
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
    `📋 *ID:* ${safeVal(row[COL.ID])}`,
    `📅 *Data:* ${fmtDate(row[COL.DATA_TROCA])}`,
    `📍 *Endereço:*`,
    `${safeVal(row[COL.LOGRADOURO])}, ${safeVal(row[COL.NUMERO])}`,
    `${safeVal(row[COL.BAIRRO])} — ${safeVal(row[COL.CIDADE])}/${safeVal(row[COL.UF])}`,
    ``,
    `🔧 *Poste:* ${safeVal(row[COL.TIPO_POSTE_OLD], '—')} → ${safeVal(row[COL.TIPO_POSTE_NEW], '—')}`,
    `👤 *Responsável:* ${safeVal(row[COL.RESPONSAVEL], '—')}`,
    ``,
    `${redeEmoji} *Rede próxima:* ${safeVal(row[COL.REDE_STATUS], 'N/A')} (${row[COL.REDE_DIST_M] ? row[COL.REDE_DIST_M] + 'm' : '—'})`,
    row[COL.OBS] ? `💬 *Obs:* ${safeVal(row[COL.OBS])}` : ''
  ].filter(Boolean).join('\n');
}

function buildMsgD0(row) {
  const redeEmoji = redeStatusEmoji(row[COL.REDE_STATUS]);

  const coordsLink = (row[COL.LAT] && row[COL.LNG])
    ? `🗺️ [Ver no mapa](https://maps.google.com/?q=${row[COL.LAT]},${row[COL.LNG]})`
    : '';

  return [
    `🔴 *TROCA DE POSTE — HOJE* 🔴`,
    ``,
    `📋 *ID:* ${safeVal(row[COL.ID])}`,
    `📅 *Data:* ${fmtDate(row[COL.DATA_TROCA])}`,
    `📍 *Endereço:*`,
    `${safeVal(row[COL.LOGRADOURO])}, ${safeVal(row[COL.NUMERO])}`,
    `${safeVal(row[COL.BAIRRO])} — ${safeVal(row[COL.CIDADE])}/${safeVal(row[COL.UF])}`,
    coordsLink,
    ``,
    `🔧 *Poste:* ${safeVal(row[COL.TIPO_POSTE_OLD], '—')} → ${safeVal(row[COL.TIPO_POSTE_NEW], '—')}`,
    `👤 *Responsável:* ${safeVal(row[COL.RESPONSAVEL], '—')}`,
    ``,
    `${redeEmoji} *Rede próxima:* ${safeVal(row[COL.REDE_STATUS], 'N/A')} (${row[COL.REDE_DIST_M] ? row[COL.REDE_DIST_M] + 'm' : '—'})`,
    row[COL.OBS] ? `💬 *Obs:* ${safeVal(row[COL.OBS])}` : '',
    ``,
    `ℹ️ Atualize o status para EXECUTADO após a conclusão.`
  ].filter(Boolean).join('\n');
}

function redeStatusEmoji(status) {
  const s = String(status || '').trim().toUpperCase();
  if (!s) return '⚪';
  if (s === 'REDE PRÓXIMA') return '🟢';
  if (s === 'ATENÇÃO') return '🟡';
  if (s === 'SEM REDE') return '🔴';
  return '⚪';
}

// ── Envio HTTP para Telegram Bot API ─────────────────────────

/**
 * Faz parse do campo TELEGRAM_CHAT_ID.
 * Aceita:
 *  - um único ID
 *  - vários IDs separados por vírgula
 */
function parseTelegramChatIds(chatIdsRaw) {
  return String(chatIdsRaw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Envia mensagem para um único chat.
 */
function sendTelegramMessage(token, chatId, text) {
  const cleanToken = String(token || '').trim();
  const cleanChatId = String(chatId || '').trim();

  if (!cleanToken) {
    return { ok: false, code: 0, body: 'Token vazio', chatId: cleanChatId };
  }

  if (!cleanChatId) {
    return { ok: false, code: 0, body: 'Chat ID vazio', chatId: cleanChatId };
  }

  const url = `https://api.telegram.org/bot${cleanToken}/sendMessage`;
  const payload = {
    chat_id: cleanChatId,
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
    const body = resp.getContentText();

    if (code === 200) {
      return { ok: true, code: code, body: body, chatId: cleanChatId };
    }

    Logger.log(`[Telegram] Erro ${code} | chat_id=${cleanChatId} | resposta=${body}`);
    return { ok: false, code: code, body: body, chatId: cleanChatId };
  } catch (e) {
    Logger.log(`[Telegram] Exceção | chat_id=${cleanChatId} | ${e.message}`);
    return { ok: false, code: 0, body: e.message, chatId: cleanChatId };
  }
}

/**
 * Envia para vários chats e considera sucesso quando ao menos um envio funciona.
 */
function sendTelegramToMany(token, chatIds, text) {
  const results = [];
  let successCount = 0;

  for (const chatId of chatIds) {
    const result = sendTelegramMessage(token, chatId, text);
    results.push(result);
    if (result.ok) successCount++;
  }

  const total = chatIds.length;
  const ok = successCount > 0;

  const summary = results.map(r =>
    `${r.chatId}: ${r.ok ? 'OK' : 'ERRO ' + r.code}`
  ).join(' | ');

  return {
    ok: ok,
    total: total,
    successCount: successCount,
    failCount: total - successCount,
    results: results,
    summary: summary
  };
}

// ── Testes manuais do Telegram ────────────────────────────────

function testarTelegram() {
  let token, chatIdsRaw;

  try {
    token = String(getProp(PROP.TELEGRAM_TOKEN) || '').trim();
    chatIdsRaw = String(getProp(PROP.TELEGRAM_CHATID) || '').trim();
  } catch (e) {
    Logger.log('[Telegram] Configure TELEGRAM_TOKEN e TELEGRAM_CHAT_ID nas Script Properties');
    return;
  }

  const chatIds = parseTelegramChatIds(chatIdsRaw);

  if (!token) {
    Logger.log('[Telegram] TELEGRAM_TOKEN vazio.');
    return;
  }

  if (!chatIds.length) {
    Logger.log('[Telegram] TELEGRAM_CHAT_ID vazio ou inválido.');
    return;
  }

  const texto =
    '✅ *Teste TROCA-POSTES*\n\n' +
    'Bot configurado e funcionando.\n' +
    `Hora: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;

  const envio = sendTelegramToMany(token, chatIds, texto);

  if (envio.ok) {
    Logger.log(`[Telegram] Teste enviado com sucesso | chats OK: ${envio.successCount}/${envio.total}`);
  } else {
    Logger.log(`[Telegram] Falha no teste | ${envio.summary}`);
  }
}

/**
 * Testa se o token do bot é válido.
 */
function validarTelegramToken() {
  let token;
  try {
    token = String(getProp(PROP.TELEGRAM_TOKEN) || '').trim();
  } catch (e) {
    Logger.log('[Telegram] TELEGRAM_TOKEN não configurado.');
    return;
  }

  if (!token) {
    Logger.log('[Telegram] TELEGRAM_TOKEN vazio.');
    return;
  }

  const url = `https://api.telegram.org/bot${token}/getMe`;

  try {
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    Logger.log(`[Telegram] validarTelegramToken | HTTP ${resp.getResponseCode()} | ${resp.getContentText()}`);
  } catch (e) {
    Logger.log(`[Telegram] validarTelegramToken | Exceção: ${e.message}`);
  }
}

// ── Fila de revisão manual ────────────────────────────────────

function adicionarFilaRevisao(ss, rowData, motivo) {
  const sh = getOrCreateSheet(ss, SHEET.FILA_REVISAO);

  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, 5).setValues([
      ['ID', 'DATA_TROCA', 'ENDERECO', 'MOTIVO', 'ADICIONADO_EM']
    ]);
  }

  const addr = `${safeVal(rowData[COL.LOGRADOURO])}, ${safeVal(rowData[COL.NUMERO])} - ${safeVal(rowData[COL.CIDADE])}`;

  // Idempotente: só adiciona se ID não existe
  const existingIds = sh.getLastRow() > 1
    ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(r => String(r[0]))
    : [];

  if (!existingIds.includes(String(rowData[COL.ID]))) {
    sh.appendRow([
      rowData[COL.ID],
      fmtDate(rowData[COL.DATA_TROCA]),
      addr,
      motivo,
      new Date()
    ]);
  }
}

// ── Utilitário simples ────────────────────────────────────────

function safeVal(value, fallback) {
  if (value === null || value === undefined || value === '') {
    return fallback !== undefined ? fallback : '';
  }
  return String(value);
}