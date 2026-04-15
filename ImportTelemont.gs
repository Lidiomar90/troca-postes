/**
 * ImportTelemont.gs
 * Sincroniza dados da aba TELEMONT → aba TROCAS com mapeamento inteligente.
 * Deduplicação por NS (ID), mapeamento de status e endereço.
 * Após importar, dispara processarTudo() para geocodificar e exportar JSON.
 *
 * Como usar:
 *   1. Cole este arquivo no Apps Script (novo arquivo .gs).
 *   2. Execute importarDaTelemont() pelo menu ou direto no editor.
 *   3. Aguarde o log — ao final, processarTudo() geocodifica e sobe o JSON.
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURAÇÃO — ajuste apenas se mudar nomes de abas
// ─────────────────────────────────────────────────────────────────────────────
var CFG_IMPORT = {
  ABA_FONTE  : 'TELEMONT',
  ABA_DESTINO: 'TROCAS',
  UF_PADRAO  : 'MG',

  // Mapeamento de Status Vistoria (TELEMONT) → STATUS (TROCAS)
  STATUS_MAP: {
    'concluída'  : 'EXECUTADO',
    'concluida'  : 'EXECUTADO',
    'concluído'  : 'EXECUTADO',
    'concluido'  : 'EXECUTADO',
    'aguardando' : 'PENDENTE',
    'pendente'   : 'PENDENTE',
    'cancelada'  : 'CANCELADO',
    'cancelado'  : 'CANCELADO',
  },

  // Colunas esperadas no cabeçalho do TELEMONT (case-insensitive)
  COLS_TELEMONT: {
    DATA_EMAIL    : 'data e-mail',
    NS            : 'ns',
    DATA_TROCA    : 'data da troca de postes',
    QUANT_POSTES  : 'quant. postes',
    HORARIO       : 'horário',
    ENDERECO      : 'endereço',
    CIDADE        : 'cidade',
    SIGMA         : 'sigma',
    EMPRESA       : 'empresa',
    STATUS_VISTORIA: 'status vistoria',
    DATA_RETORNO  : 'data retorno',
    REDE_PADRONIZADA: 'rede padronizada?',
    OBSERVACAO    : 'observação',
  },

  // Colunas esperadas no cabeçalho do TROCAS (case-insensitive)
  COLS_TROCAS: [
    'ID','DATA_TROCA','LOGRADOURO','NUMERO','BAIRRO','CIDADE','UF','CEP',
    'TIPO_POSTE_OLD','TIPO_POSTE_NEW','RESPONSAVEL','STATUS','OBS',
    'LAT','LNG','GEO_STATUS','REDE_STATUS','REDE_DIST_M',
    'ALERTA_D1_SENT','ALERTA_D0_SENT','PROC_EM'
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÃO PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
function importarDaTelemont() {
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var srcSh   = ss.getSheetByName(CFG_IMPORT.ABA_FONTE);
  var dstSh   = ss.getSheetByName(CFG_IMPORT.ABA_DESTINO);

  if (!srcSh) { Logger.log('❌ Aba não encontrada: ' + CFG_IMPORT.ABA_FONTE); return; }
  if (!dstSh) { Logger.log('❌ Aba não encontrada: ' + CFG_IMPORT.ABA_DESTINO); return; }

  // ── 1. Ler dados da fonte ──────────────────────────────────────────────────
  var srcData = srcSh.getDataRange().getValues();
  if (srcData.length < 2) { Logger.log('⚠️ TELEMONT sem dados.'); return; }

  var srcHeader = srcData[0].map(function(h){ return String(h).trim().toLowerCase(); });
  var srcRows   = srcData.slice(1);

  // Índices das colunas fonte
  var SI = mapearIndices_(srcHeader, CFG_IMPORT.COLS_TELEMONT);
  Logger.log('Índices TELEMONT: ' + JSON.stringify(SI));

  // ── 2. Ler IDs já existentes no TROCAS (deduplicação) ─────────────────────
  var dstData   = dstSh.getDataRange().getValues();
  var dstHeader = dstData[0].map(function(h){ return String(h).trim().toUpperCase(); });

  // Garantir que TROCAS tem o cabeçalho correto
  garantirCabecalhoTrocas_(dstSh, dstHeader);
  // Recarregar após possível criação do cabeçalho
  dstData   = dstSh.getDataRange().getValues();
  dstHeader = dstData[0].map(function(h){ return String(h).trim().toUpperCase(); });

  var idxID = dstHeader.indexOf('ID');
  var existingIDs = {};
  for (var r = 1; r < dstData.length; r++) {
    var id = String(dstData[r][idxID]).trim();
    if (id) existingIDs[id] = true;
  }
  Logger.log('IDs já em TROCAS: ' + Object.keys(existingIDs).length);

  // ── 3. Mapear e importar ───────────────────────────────────────────────────
  var DI = {};
  CFG_IMPORT.COLS_TROCAS.forEach(function(col, i){ DI[col] = i; });

  var novos = 0, ignorados = 0, erros = 0;
  var lote  = []; // linhas novas a inserir de uma vez

  srcRows.forEach(function(row, idx) {
    try {
      var ns = String(obterValor_(row, SI.NS)).trim();
      if (!ns || ns === '') { ignorados++; return; }

      // Deduplicar
      if (existingIDs[ns]) { ignorados++; return; }

      var destRow = new Array(CFG_IMPORT.COLS_TROCAS.length).fill('');

      // ID
      destRow[DI['ID']] = ns;

      // DATA_TROCA
      var dataTroca = obterValor_(row, SI.DATA_TROCA);
      destRow[DI['DATA_TROCA']] = formatarData_(dataTroca);

      // ENDEREÇO → LOGRADOURO + NUMERO + BAIRRO
      var endFull = String(obterValor_(row, SI.ENDERECO)).trim();
      var endParts = parseEndereco_(endFull);
      destRow[DI['LOGRADOURO']] = endParts.logradouro;
      destRow[DI['NUMERO']]     = endParts.numero;
      destRow[DI['BAIRRO']]     = endParts.bairro;

      // CIDADE
      destRow[DI['CIDADE']] = String(obterValor_(row, SI.CIDADE)).trim();

      // UF
      destRow[DI['UF']] = CFG_IMPORT.UF_PADRAO;

      // CEP — não disponível na fonte
      destRow[DI['CEP']] = '';

      // TIPO_POSTE_OLD / NEW — não disponível, deixar vazio
      destRow[DI['TIPO_POSTE_OLD']] = '';
      destRow[DI['TIPO_POSTE_NEW']] = '';

      // RESPONSAVEL ← Empresa
      destRow[DI['RESPONSAVEL']] = String(obterValor_(row, SI.EMPRESA)).trim();

      // STATUS ← Status Vistoria (com mapeamento)
      var statusOrig = String(obterValor_(row, SI.STATUS_VISTORIA)).trim().toLowerCase();
      destRow[DI['STATUS']] = CFG_IMPORT.STATUS_MAP[statusOrig] || statusOrig.toUpperCase() || 'PENDENTE';

      // OBS ← Observação + Quant. Postes + Rede Padronizada
      var obs         = String(obterValor_(row, SI.OBSERVACAO)).trim();
      var quant       = obterValor_(row, SI.QUANT_POSTES);
      var redePadr    = String(obterValor_(row, SI.REDE_PADRONIZADA)).trim();
      var sigma       = String(obterValor_(row, SI.SIGMA)).trim();
      var obsPartes   = [];
      if (quant)    obsPartes.push('Qtd postes: ' + quant);
      if (sigma)    obsPartes.push('Sigma: ' + sigma);
      if (redePadr) obsPartes.push('Rede padr.: ' + redePadr);
      if (obs)      obsPartes.push(obs);
      destRow[DI['OBS']] = obsPartes.join(' | ');

      // Campos de geocodificação e rede — vazios, serão preenchidos pelo processarTudo()
      destRow[DI['LAT']]           = '';
      destRow[DI['LNG']]           = '';
      destRow[DI['GEO_STATUS']]    = 'PENDENTE';
      destRow[DI['REDE_STATUS']]   = '';
      destRow[DI['REDE_DIST_M']]   = '';
      destRow[DI['ALERTA_D1_SENT']]= 'FALSE';
      destRow[DI['ALERTA_D0_SENT']]= 'FALSE';
      destRow[DI['PROC_EM']]       = '';

      lote.push(destRow);
      existingIDs[ns] = true; // evitar dupl. dentro do próprio lote
      novos++;
    } catch(e) {
      Logger.log('Erro na linha ' + (idx+2) + ': ' + e.message);
      erros++;
    }
  });

  // ── 4. Gravar lote de uma vez (muito mais rápido) ──────────────────────────
  if (lote.length > 0) {
    var primeiraLinhaVazia = dstSh.getLastRow() + 1;
    dstSh.getRange(primeiraLinhaVazia, 1, lote.length, CFG_IMPORT.COLS_TROCAS.length)
         .setValues(lote);
    SpreadsheetApp.flush();
    Logger.log('✅ ' + novos + ' registros importados. Ignorados: ' + ignorados + '. Erros: ' + erros);
  } else {
    Logger.log('ℹ️ Nenhum registro novo encontrado. Ignorados: ' + ignorados + '. Erros: ' + erros);
  }

  // ── 5. Disparar processarTudo() se existir ────────────────────────────────
  try {
    if (typeof processarTudo === 'function') {
      Logger.log('🔄 Iniciando processarTudo()...');
      processarTudo();
    } else {
      Logger.log('⚠️ processarTudo() não encontrado — execute manualmente para geocodificar e exportar JSON.');
    }
  } catch(e) {
    Logger.log('⚠️ processarTudo() falhou: ' + e.message + ' — execute manualmente.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÃO: Executa apenas o sync sem disparar processarTudo (útil para testes)
// ─────────────────────────────────────────────────────────────────────────────
function importarDaTelomontSemProcessar() {
  // Substitui processarTudo temporariamente
  var _orig = (typeof processarTudo !== 'undefined') ? processarTudo : null;
  // Hack: chama o import diretamente com flag
  _importarInterna_(false);
}

// Alias que não chama processarTudo — para debug
function _importarInterna_(chamarProcessar) {
  chamarProcessar = (chamarProcessar === undefined) ? true : chamarProcessar;
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var srcSh   = ss.getSheetByName(CFG_IMPORT.ABA_FONTE);
  var dstSh   = ss.getSheetByName(CFG_IMPORT.ABA_DESTINO);
  if (!srcSh || !dstSh) { Logger.log('Abas não encontradas.'); return; }

  var srcData = srcSh.getDataRange().getValues();
  if (srcData.length < 2) { Logger.log('TELEMONT vazio.'); return; }
  var srcHeader = srcData[0].map(function(h){ return String(h).trim().toLowerCase(); });
  var srcRows   = srcData.slice(1);
  var SI = mapearIndices_(srcHeader, CFG_IMPORT.COLS_TELEMONT);

  var dstData   = dstSh.getDataRange().getValues();
  var dstHeader = dstData[0].map(function(h){ return String(h).trim().toUpperCase(); });
  garantirCabecalhoTrocas_(dstSh, dstHeader);
  dstData   = dstSh.getDataRange().getValues();
  dstHeader = dstData[0].map(function(h){ return String(h).trim().toUpperCase(); });

  var idxID = dstHeader.indexOf('ID');
  var existingIDs = {};
  for (var r = 1; r < dstData.length; r++) {
    var id = String(dstData[r][idxID]).trim();
    if (id) existingIDs[id] = true;
  }

  var DI = {};
  CFG_IMPORT.COLS_TROCAS.forEach(function(col, i){ DI[col] = i; });

  var lote = [], novos = 0, ignorados = 0;
  srcRows.forEach(function(row) {
    var ns = String(obterValor_(row, SI.NS)).trim();
    if (!ns || existingIDs[ns]) { ignorados++; return; }

    var destRow = new Array(CFG_IMPORT.COLS_TROCAS.length).fill('');
    destRow[DI['ID']]          = ns;
    destRow[DI['DATA_TROCA']]  = formatarData_(obterValor_(row, SI.DATA_TROCA));
    var endParts = parseEndereco_(String(obterValor_(row, SI.ENDERECO)).trim());
    destRow[DI['LOGRADOURO']]  = endParts.logradouro;
    destRow[DI['NUMERO']]      = endParts.numero;
    destRow[DI['BAIRRO']]      = endParts.bairro;
    destRow[DI['CIDADE']]      = String(obterValor_(row, SI.CIDADE)).trim();
    destRow[DI['UF']]          = CFG_IMPORT.UF_PADRAO;
    destRow[DI['RESPONSAVEL']] = String(obterValor_(row, SI.EMPRESA)).trim();
    var statusOrig = String(obterValor_(row, SI.STATUS_VISTORIA)).trim().toLowerCase();
    destRow[DI['STATUS']]      = CFG_IMPORT.STATUS_MAP[statusOrig] || 'PENDENTE';
    var obsPartes = [];
    var quant = obterValor_(row, SI.QUANT_POSTES);
    var sigma = String(obterValor_(row, SI.SIGMA)).trim();
    var redePadr = String(obterValor_(row, SI.REDE_PADRONIZADA)).trim();
    var obs = String(obterValor_(row, SI.OBSERVACAO)).trim();
    if (quant)    obsPartes.push('Qtd postes: ' + quant);
    if (sigma)    obsPartes.push('Sigma: ' + sigma);
    if (redePadr) obsPartes.push('Rede padr.: ' + redePadr);
    if (obs)      obsPartes.push(obs);
    destRow[DI['OBS']]            = obsPartes.join(' | ');
    destRow[DI['GEO_STATUS']]     = 'PENDENTE';
    destRow[DI['ALERTA_D1_SENT']] = 'FALSE';
    destRow[DI['ALERTA_D0_SENT']] = 'FALSE';

    lote.push(destRow);
    existingIDs[ns] = true;
    novos++;
  });

  if (lote.length > 0) {
    dstSh.getRange(dstSh.getLastRow() + 1, 1, lote.length, CFG_IMPORT.COLS_TROCAS.length).setValues(lote);
    SpreadsheetApp.flush();
  }
  Logger.log('✅ Importados: ' + novos + ' | Ignorados: ' + ignorados);
  if (chamarProcessar && typeof processarTudo === 'function') processarTudo();
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Mapeia nomes de colunas (COLS_TELEMONT) → índices no array de cabeçalho */
function mapearIndices_(header, colsDef) {
  var resultado = {};
  Object.keys(colsDef).forEach(function(chave) {
    var nomeProcurado = colsDef[chave].toLowerCase();
    var idx = header.findIndex(function(h){ return h.indexOf(nomeProcurado) !== -1 || nomeProcurado.indexOf(h) !== -1; });
    // Tentativa exata primeiro
    var idxExato = header.indexOf(nomeProcurado);
    resultado[chave] = (idxExato >= 0) ? idxExato : (idx >= 0 ? idx : -1);
  });
  return resultado;
}

/** Retorna o valor de uma linha dado o índice (retorna '' se -1) */
function obterValor_(row, idx) {
  if (idx < 0 || idx >= row.length) return '';
  return row[idx] !== null && row[idx] !== undefined ? row[idx] : '';
}

/** Formata data para string YYYY-MM-DD (aceita Date ou string) */
function formatarData_(val) {
  if (!val || val === '') return '';
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return '';
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var s = String(val).trim();
  // Já no formato esperado
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  // dd/mm/yyyy
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + pad2_(m[2]) + '-' + pad2_(m[1]);
  return s;
}
function pad2_(n) { return String(n).padStart(2, '0'); }

/**
 * Tenta separar endereço completo em logradouro, numero e bairro.
 * Exemplos de entrada:
 *   "Rua das Flores, 123, Bairro Centro"
 *   "Av. Brasil 456 - Savassi"
 *   "R. XV de Novembro, 78"
 */
function parseEndereco_(end) {
  if (!end) return { logradouro: '', numero: '', bairro: '' };

  // Separar por vírgula ou hífen
  var partes = end.split(/,|-/).map(function(p){ return p.trim(); }).filter(Boolean);

  var logradouro = '', numero = '', bairro = '';

  if (partes.length === 0) return { logradouro: end, numero: '', bairro: '' };

  // Primeira parte: pode conter número inline (ex: "Rua X 123")
  var primeiro = partes[0];
  var matchNum = primeiro.match(/^(.+?)\s+(\d+\w*)\s*$/);
  if (matchNum) {
    logradouro = matchNum[1].trim();
    numero     = matchNum[2].trim();
  } else {
    logradouro = primeiro;
  }

  // Segunda parte: se for número puro, é o número; senão, bairro
  if (partes.length >= 2) {
    var seg = partes[1];
    if (/^\d+\w*$/.test(seg)) {
      numero = seg;
      if (partes.length >= 3) bairro = partes.slice(2).join(', ');
    } else {
      if (!numero) {
        // Tentar extrair número do logradouro novamente
        var m2 = logradouro.match(/^(.+?)\s+(\d+\w*)\s*$/);
        if (m2) { logradouro = m2[1]; numero = m2[2]; }
      }
      bairro = partes.slice(1).join(', ');
    }
  }

  return {
    logradouro: logradouro.trim(),
    numero    : numero.trim(),
    bairro    : bairro.trim(),
  };
}

/** Garante que a aba TROCAS tem o cabeçalho correto na linha 1 */
function garantirCabecalhoTrocas_(sh, headerAtual) {
  var esperado = CFG_IMPORT.COLS_TROCAS;
  var temHeader = headerAtual.some(function(h){ return h !== ''; });
  if (!temHeader) {
    sh.getRange(1, 1, 1, esperado.length).setValues([esperado]);
    SpreadsheetApp.flush();
    Logger.log('✅ Cabeçalho criado em TROCAS.');
  }
}

/**
 * Cria gatilho diário para importarDaTelemont (executa 1x/dia às 6h).
 * Execute esta função UMA VEZ manualmente para ativar a automação.
 */
function criarGatilhoDiario() {
  // Remover gatilhos antigos da mesma função para evitar duplicatas
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'importarDaTelemont') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('importarDaTelemont')
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .create();
  Logger.log('✅ Gatilho diário criado: importarDaTelemont às 06h.');
}
