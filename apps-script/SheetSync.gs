// ============================================================
// SheetSync.gs — Inicialização e manutenção das abas
// ============================================================

/**
 * Cria todas as abas auxiliares com cabeçalhos corretos.
 * Execute uma única vez após criar o projeto.
 */
function inicializarPlanilha() {
  const ss = getSpreadsheet();

  // ── Aba TROCAS ────────────────────────────────────────────
  const shTrocas = getOrCreateSheet(ss, SHEET.TROCAS);
  if (shTrocas.getLastRow() === 0) {
    const headers = [
      'ID', 'DATA_TROCA', 'LOGRADOURO', 'NUMERO', 'BAIRRO',
      'CIDADE', 'UF', 'CEP', 'TIPO_POSTE_OLD', 'TIPO_POSTE_NEW',
      'RESPONSAVEL', 'STATUS', 'OBS',
      'LAT', 'LNG', 'GEO_STATUS',
      'REDE_STATUS', 'REDE_DIST_M',
      'ALERTA_D1_SENT', 'ALERTA_D0_SENT', 'PROC_EM'
    ];
    shTrocas.getRange(1, 1, 1, headers.length).setValues([headers]);
    shTrocas.getRange(1, 1, 1, headers.length)
      .setBackground('#1a73e8').setFontColor('#ffffff').setFontWeight('bold');
    shTrocas.setFrozenRows(1);
    // Validação na coluna STATUS
    const statusRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['PENDENTE','AGENDADO','EXECUTADO','CANCELADO'], true)
      .build();
    shTrocas.getRange(2, COL.STATUS+1, 1000, 1).setDataValidation(statusRule);
    Logger.log('[SheetSync] Aba TROCAS criada com cabeçalho');
  }

  // ── Aba CONFIG ────────────────────────────────────────────
  const shConfig = getOrCreateSheet(ss, SHEET.CONFIG);
  if (shConfig.getLastRow() === 0) {
    shConfig.getRange(1,1,1,3).setValues([['CHAVE','VALOR','DESCRICAO']]);
    shConfig.getRange(1,1,1,3)
      .setBackground('#34a853').setFontColor('#ffffff').setFontWeight('bold');
    const configRows = [
      ['ALERTA_ATIVO', 'SIM', 'SIM ou NAO — habilita envio de alertas Telegram'],
      ['TELEGRAM_TOKEN', '(configure nas Script Properties)', 'Token do bot Telegram'],
      ['TELEGRAM_CHAT_ID', '(configure nas Script Properties)', 'ID do chat/grupo'],
      ['GH_REPO', 'Lidiomar90/troca-postes', 'Repositório GitHub Pages'],
      ['GH_BRANCH', 'main', 'Branch do repositório'],
      ['PROX_REDE_PROXIMA_M', '150', 'Limite REDE PRÓXIMA (metros)'],
      ['PROX_ATENCAO_M', '250', 'Limite ATENÇÃO (metros)'],
      ['VERSAO', '1.0.0', 'Versão do script'],
    ];
    shConfig.getRange(2, 1, configRows.length, 3).setValues(configRows);
    Logger.log('[SheetSync] Aba CONFIG criada');
  }

  // ── Aba BASE_REDE ──────────────────────────────────────────
  const shRede = getOrCreateSheet(ss, SHEET.BASE_REDE);
  if (shRede.getLastRow() === 0) {
    shRede.getRange(1,1,1,4).setValues([['lat','lng','sigla','tipo']]);
    shRede.getRange(1,1,1,4)
      .setBackground('#e8710a').setFontColor('#ffffff').setFontWeight('bold');
    Logger.log('[SheetSync] Aba BASE_REDE criada. Importe os nós da rede ou execute importarBaseRedeSupabase()');
  }

  // ── Aba LOG_EXECUCAO ──────────────────────────────────────
  const shLog = getOrCreateSheet(ss, SHEET.LOG_EXECUCAO);
  if (shLog.getLastRow() === 0) {
    shLog.getRange(1,1,1,4).setValues([['TIMESTAMP','OPERACAO','MENSAGEM','STATUS']]);
    shLog.getRange(1,1,1,4)
      .setBackground('#5f6368').setFontColor('#ffffff').setFontWeight('bold');
    shLog.setFrozenRows(1);
    Logger.log('[SheetSync] Aba LOG_EXECUCAO criada');
  }

  // ── Aba LOG_ALERTAS ───────────────────────────────────────
  const shLogAlertas = getOrCreateSheet(ss, SHEET.LOG_ALERTAS);
  if (shLogAlertas.getLastRow() === 0) {
    shLogAlertas.getRange(1,1,1,4).setValues([['TIMESTAMP','TIPO','MENSAGEM','QTDE']]);
    shLogAlertas.getRange(1,1,1,4)
      .setBackground('#5f6368').setFontColor('#ffffff').setFontWeight('bold');
    shLogAlertas.setFrozenRows(1);
  }

  // ── Aba FILA_REVISAO_MANUAL ───────────────────────────────
  const shFila = getOrCreateSheet(ss, SHEET.FILA_REVISAO);
  if (shFila.getLastRow() === 0) {
    shFila.getRange(1,1,1,5).setValues([['ID','DATA_TROCA','ENDERECO','MOTIVO','ADICIONADO_EM']]);
    shFila.getRange(1,1,1,5)
      .setBackground('#ea4335').setFontColor('#ffffff').setFontWeight('bold');
    shFila.setFrozenRows(1);
  }

  Logger.log('[SheetSync] Inicialização concluída!');
  try {
    SpreadsheetApp.getUi().alert('✅ Planilha inicializada com sucesso!\n\nPróximos passos:\n1. Configure as Script Properties (token Telegram, etc.)\n2. Importe ou cole os dados na aba TROCAS\n3. Execute "Processar Tudo" para geocodificar e verificar rede');
  } catch(e) {
    Logger.log('[SheetSync] Alerta UI ignorado (executado fora do contexto da planilha).');
  }
}

/**
 * Marca registro como EXECUTADO e registra data.
 * Pode ser chamado manualmente pelo menu.
 */
function marcarExecutado() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.TROCAS);
  const range = sh.getActiveRange();
  const row = range.getRow();
  if (row <= 1) return; // cabeçalho
  sh.getRange(row, COL.STATUS+1).setValue('EXECUTADO');
  sh.getRange(row, COL.PROC_EM+1).setValue(new Date());
  Logger.log(`[SheetSync] Linha ${row} marcada como EXECUTADO`);
}

// ── Log helpers ───────────────────────────────────────────────

function logExecucao(operacao, mensagem, statusStr) {
  try {
    const ss = getSpreadsheet();
    const sh = getOrCreateSheet(ss, SHEET.LOG_EXECUCAO);
    sh.appendRow([new Date(), operacao, mensagem, statusStr || 'OK']);
    // Limita a 2000 linhas para não encher a planilha
    if (sh.getLastRow() > 2001) {
      sh.deleteRows(2, sh.getLastRow() - 2001);
    }
  } catch (e) {
    Logger.log(`[LogExecucao] Erro ao logar: ${e.message}`);
  }
}

function logAlerta(tipo, mensagem, qtde) {
  try {
    const ss = getSpreadsheet();
    const sh = getOrCreateSheet(ss, SHEET.LOG_ALERTAS);
    sh.appendRow([new Date(), tipo, mensagem, qtde || 0]);
  } catch (e) {
    Logger.log(`[LogAlerta] Erro ao logar: ${e.message}`);
  }
}
