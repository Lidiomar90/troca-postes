/**
 * ImportTelemont_Auto.gs
 * Sincronização automática TELEMONT -> TROCAS
 * - Atualiza ou insere por NS
 * - Dispara ao editar a aba TELEMONT
 * - Tem rotina diária de reconciliação
 * - Usa LockService para evitar concorrência
 */

// ============================================================================
// CONFIG
// ============================================================================
var CFG_IMPORT = {
  ABA_FONTE: 'TELEMONT',
  ABA_DESTINO: 'TROCAS',
  UF_PADRAO: 'MG',
  TIMEZONE: Session.getScriptTimeZone(),

  STATUS_MAP: {
    'concluída': 'EXECUTADO',
    'concluida': 'EXECUTADO',
    'concluído': 'EXECUTADO',
    'concluido': 'EXECUTADO',
    'aguardando': 'PENDENTE',
    'pendente': 'PENDENTE',
    'cancelada': 'CANCELADO',
    'cancelado': 'CANCELADO'
  },

  COLS_TELEMONT: {
    DATA_EMAIL: 'data e-mail',
    NS: 'ns',
    DATA_TROCA: 'data da troca de postes',
    QUANT_POSTES: 'quant. postes',
    HORARIO: 'horário',
    ENDERECO: 'endereço',
    CIDADE: 'cidade',
    SIGMA: 'sigma',
    EMPRESA: 'empresa',
    STATUS_VISTORIA: 'status vistoria',
    DATA_RETORNO: 'data retorno',
    REDE_PADRONIZADA: 'rede padronizada?',
    OBSERVACAO: 'observação'
  },

  COLS_TROCAS: [
    'ID','DATA_TROCA','LOGRADOURO','NUMERO','BAIRRO','CIDADE','UF','CEP',
    'TIPO_POSTE_OLD','TIPO_POSTE_NEW','RESPONSAVEL','STATUS','OBS',
    'LAT','LNG','GEO_STATUS','REDE_STATUS','REDE_DIST_M',
    'ALERTA_D1_SENT','ALERTA_D0_SENT','PROC_EM'
  ]
};

// ============================================================================
// MENU
// ============================================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Telemont')
    .addItem('Sincronizar tudo agora', 'sincronizarTelemontCompleto')
    .addItem('Criar automações', 'criarAutomacoesTelemont')
    .addItem('Remover automações', 'removerAutomacoesTelemont')
    .addToUi();
}

// ============================================================================
// TRIGGER DE EDIÇÃO
// Use gatilho instalável criado por criarAutomacoesTelemont()
// ============================================================================
function onEditTelemont(e) {
  if (!e || !e.range) return;

  var sh = e.range.getSheet();
  if (!sh || sh.getName() !== CFG_IMPORT.ABA_FONTE) return;

  var row = e.range.getRow();
  if (row <= 1) return; // ignora cabeçalho

  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) return;

  try {
    sincronizarLinhaTelemont_(row);
  } catch (err) {
    Logger.log('Erro onEditTelemont: ' + err.message);
  } finally {
    lock.releaseLock();
  }
}

// ============================================================================
// SINCRONIZAÇÃO COMPLETA
// ============================================================================
function sincronizarTelemontCompleto() {
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var srcSh = ss.getSheetByName(CFG_IMPORT.ABA_FONTE);
    var dstSh = ss.getSheetByName(CFG_IMPORT.ABA_DESTINO);

    if (!srcSh) throw new Error('Aba fonte não encontrada: ' + CFG_IMPORT.ABA_FONTE);
    if (!dstSh) throw new Error('Aba destino não encontrada: ' + CFG_IMPORT.ABA_DESTINO);

    garantirCabecalhoTrocas_(dstSh);

    var srcData = srcSh.getDataRange().getValues();
    if (srcData.length < 2) {
      Logger.log('TELEMONT sem dados.');
      return;
    }

    var srcHeader = normalizarCabecalho_(srcData[0], 'lower');
    var SI = mapearIndices_(srcHeader, CFG_IMPORT.COLS_TELEMONT);

    var dstData = dstSh.getDataRange().getValues();
    var dstHeader = normalizarCabecalho_(dstData[0], 'upper');
    var DI = mapearDestino_(dstHeader);

    var mapaDestino = montarMapaIdsDestino_(dstData, DI.ID);

    var inserts = [];
    var updates = [];

    for (var i = 1; i < srcData.length; i++) {
      var row = srcData[i];
      var ns = String(obterValor_(row, SI.NS)).trim();
      if (!ns) continue;

      var destRow = montarLinhaDestino_(row, SI, DI);

      if (mapaDestino[ns]) {
        updates.push({
          rowNumber: mapaDestino[ns],
          values: destRow
        });
      } else {
        inserts.push(destRow);
      }
    }

    // Atualizações linha a linha
    updates.forEach(function(item) {
      dstSh.getRange(item.rowNumber, 1, 1, CFG_IMPORT.COLS_TROCAS.length)
        .setValues([item.values]);
    });

    // Inserções em lote
    if (inserts.length > 0) {
      dstSh.getRange(dstSh.getLastRow() + 1, 1, inserts.length, CFG_IMPORT.COLS_TROCAS.length)
        .setValues(inserts);
    }

    SpreadsheetApp.flush();
    Logger.log('Sincronização concluída. Inseridos: ' + inserts.length + ' | Atualizados: ' + updates.length);

    dispararProcessamentoSeguro_();

  } finally {
    lock.releaseLock();
  }
}

// ============================================================================
// SINCRONIZAÇÃO DE UMA LINHA
// ============================================================================
function sincronizarLinhaTelemont_(rowNumber) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var srcSh = ss.getSheetByName(CFG_IMPORT.ABA_FONTE);
  var dstSh = ss.getSheetByName(CFG_IMPORT.ABA_DESTINO);

  if (!srcSh) throw new Error('Aba fonte não encontrada.');
  if (!dstSh) throw new Error('Aba destino não encontrada.');

  garantirCabecalhoTrocas_(dstSh);

  var srcLastCol = srcSh.getLastColumn();
  var srcHeader = normalizarCabecalho_(srcSh.getRange(1, 1, 1, srcLastCol).getValues()[0], 'lower');
  var SI = mapearIndices_(srcHeader, CFG_IMPORT.COLS_TELEMONT);

  var row = srcSh.getRange(rowNumber, 1, 1, srcLastCol).getValues()[0];
  var ns = String(obterValor_(row, SI.NS)).trim();
  if (!ns) return;

  var dstData = dstSh.getDataRange().getValues();
  var dstHeader = normalizarCabecalho_(dstData[0], 'upper');
  var DI = mapearDestino_(dstHeader);
  var mapaDestino = montarMapaIdsDestino_(dstData, DI.ID);

  var destRow = montarLinhaDestino_(row, SI, DI);

  if (mapaDestino[ns]) {
    dstSh.getRange(mapaDestino[ns], 1, 1, CFG_IMPORT.COLS_TROCAS.length)
      .setValues([destRow]);
    Logger.log('Linha atualizada em TROCAS para NS: ' + ns);
  } else {
    dstSh.getRange(dstSh.getLastRow() + 1, 1, 1, CFG_IMPORT.COLS_TROCAS.length)
      .setValues([destRow]);
    Logger.log('Linha inserida em TROCAS para NS: ' + ns);
  }

  SpreadsheetApp.flush();
  dispararProcessamentoSeguro_();
}

// ============================================================================
// AUTOMAÇÕES
// ============================================================================
function criarAutomacoesTelemont() {
  removerAutomacoesTelemont();

  var ssId = SpreadsheetApp.getActiveSpreadsheet().getId();

  ScriptApp.newTrigger('onEditTelemont')
    .forSpreadsheet(ssId)
    .onEdit()
    .create();

  ScriptApp.newTrigger('sincronizarTelemontCompleto')
    .timeBased()
    .everyHours(1)
    .create();

  Logger.log('Automações criadas: onEdit + sincronização horária.');
}

function removerAutomacoesTelemont() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (fn === 'onEditTelemont' || fn === 'sincronizarTelemontCompleto') {
      ScriptApp.deleteTrigger(t);
    }
  });
  Logger.log('Automações antigas removidas.');
}

// ============================================================================
// MONTAGEM DA LINHA DESTINO
// ============================================================================
function montarLinhaDestino_(row, SI, DI) {
  var destRow = new Array(CFG_IMPORT.COLS_TROCAS.length).fill('');

  var ns = String(obterValor_(row, SI.NS)).trim();
  var dataTroca = obterValor_(row, SI.DATA_TROCA);
  var endereco = String(obterValor_(row, SI.ENDERECO)).trim();
  var cidade = String(obterValor_(row, SI.CIDADE)).trim();
  var empresa = String(obterValor_(row, SI.EMPRESA)).trim();
  var statusOrig = String(obterValor_(row, SI.STATUS_VISTORIA)).trim().toLowerCase();
  var quant = obterValor_(row, SI.QUANT_POSTES);
  var sigma = String(obterValor_(row, SI.SIGMA)).trim();
  var redePadr = String(obterValor_(row, SI.REDE_PADRONIZADA)).trim();
  var obs = String(obterValor_(row, SI.OBSERVACAO)).trim();

  var endParts = parseEndereco_(endereco);
  var statusMapeado = CFG_IMPORT.STATUS_MAP[statusOrig] || (statusOrig ? statusOrig.toUpperCase() : 'PENDENTE');

  var obsPartes = [];
  if (quant) obsPartes.push('Qtd postes: ' + quant);
  if (sigma) obsPartes.push('Sigma: ' + sigma);
  if (redePadr) obsPartes.push('Rede padr.: ' + redePadr);
  if (obs) obsPartes.push(obs);

  destRow[DI.ID] = ns;
  destRow[DI.DATA_TROCA] = formatarData_(dataTroca);
  destRow[DI.LOGRADOURO] = endParts.logradouro;
  destRow[DI.NUMERO] = endParts.numero;
  destRow[DI.BAIRRO] = endParts.bairro;
  destRow[DI.CIDADE] = cidade;
  destRow[DI.UF] = CFG_IMPORT.UF_PADRAO;
  destRow[DI.CEP] = '';
  destRow[DI.TIPO_POSTE_OLD] = '';
  destRow[DI.TIPO_POSTE_NEW] = '';
  destRow[DI.RESPONSAVEL] = empresa;
  destRow[DI.STATUS] = statusMapeado;
  destRow[DI.OBS] = obsPartes.join(' | ');

  destRow[DI.LAT] = '';
  destRow[DI.LNG] = '';
  destRow[DI.GEO_STATUS] = 'PENDENTE';
  destRow[DI.REDE_STATUS] = '';
  destRow[DI.REDE_DIST_M] = '';
  destRow[DI.ALERTA_D1_SENT] = 'FALSE';
  destRow[DI.ALERTA_D0_SENT] = 'FALSE';
  destRow[DI.PROC_EM] = Utilities.formatDate(new Date(), CFG_IMPORT.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');

  return destRow;
}

// ============================================================================
// HELPERS
// ============================================================================
function normalizarCabecalho_(header, mode) {
  return header.map(function(h) {
    h = String(h || '').trim();
    return mode === 'upper' ? h.toUpperCase() : h.toLowerCase();
  });
}

function mapearIndices_(header, colsDef) {
  var resultado = {};
  Object.keys(colsDef).forEach(function(chave) {
    var nome = colsDef[chave].toLowerCase();
    var idxExato = header.indexOf(nome);
    if (idxExato >= 0) {
      resultado[chave] = idxExato;
      return;
    }

    var idxParcial = header.findIndex(function(h) {
      return h.indexOf(nome) !== -1 || nome.indexOf(h) !== -1;
    });

    resultado[chave] = idxParcial >= 0 ? idxParcial : -1;
  });
  return resultado;
}

function mapearDestino_(dstHeader) {
  var DI = {};
  CFG_IMPORT.COLS_TROCAS.forEach(function(col) {
    DI[col] = dstHeader.indexOf(col);
  });
  return DI;
}

function montarMapaIdsDestino_(dstData, idxID) {
  var mapa = {};
  for (var i = 1; i < dstData.length; i++) {
    var id = String(dstData[i][idxID] || '').trim();
    if (id) mapa[id] = i + 1;
  }
  return mapa;
}

function obterValor_(row, idx) {
  if (idx < 0 || idx >= row.length) return '';
  return row[idx] == null ? '' : row[idx];
}

function formatarData_(val) {
  if (!val) return '';
  if (val instanceof Date && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, CFG_IMPORT.TIMEZONE, 'yyyy-MM-dd');
  }

  var s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);

  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + pad2_(m[2]) + '-' + pad2_(m[1]);

  return s;
}

function pad2_(n) {
  return String(n).padStart(2, '0');
}

function parseEndereco_(end) {
  if (!end) return { logradouro: '', numero: '', bairro: '' };

  var partes = end.split(/,|-/).map(function(p) {
    return p.trim();
  }).filter(Boolean);

  var logradouro = '';
  var numero = '';
  var bairro = '';

  if (partes.length === 0) {
    return { logradouro: end, numero: '', bairro: '' };
  }

  var primeiro = partes[0];
  var matchNum = primeiro.match(/^(.+?)\s+(\d+\w*)\s*$/);
  if (matchNum) {
    logradouro = matchNum[1].trim();
    numero = matchNum[2].trim();
  } else {
    logradouro = primeiro;
  }

  if (partes.length >= 2) {
    var seg = partes[1];
    if (/^\d+\w*$/.test(seg)) {
      numero = seg;
      if (partes.length >= 3) bairro = partes.slice(2).join(', ');
    } else {
      bairro = partes.slice(1).join(', ');
    }
  }

  return {
    logradouro: logradouro.trim(),
    numero: numero.trim(),
    bairro: bairro.trim()
  };
}

function garantirCabecalhoTrocas_(sh) {
  var lastCol = Math.max(sh.getLastColumn(), CFG_IMPORT.COLS_TROCAS.length);
  var atual = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var vazio = atual.every(function(v) { return String(v || '').trim() === ''; });

  if (vazio) {
    sh.getRange(1, 1, 1, CFG_IMPORT.COLS_TROCAS.length)
      .setValues([CFG_IMPORT.COLS_TROCAS]);
    SpreadsheetApp.flush();
    return;
  }

  for (var i = 0; i < CFG_IMPORT.COLS_TROCAS.length; i++) {
    if (String(atual[i] || '').trim().toUpperCase() !== CFG_IMPORT.COLS_TROCAS[i]) {
      sh.getRange(1, 1, 1, CFG_IMPORT.COLS_TROCAS.length)
        .setValues([CFG_IMPORT.COLS_TROCAS]);
      SpreadsheetApp.flush();
      return;
    }
  }
}

function dispararProcessamentoSeguro_() {
  try {
    if (typeof processarTudo === 'function') {
      processarTudo();
    } else {
      Logger.log('processarTudo() não encontrado.');
    }
  } catch (e) {
    Logger.log('Falha em processarTudo(): ' + e.message);
  }
}