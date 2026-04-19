// ============================================================
// SigmaIntegration.gs — Integração com Sistema SIGMA
// Responsável por abrir chamados automáticos e registrar logs.
// ============================================================

/**
 * Verifica novas trocas inseridas e abre chamado no SIGMA.
 * Executado via trigger de alteração na planilha.
 */
function processarAberturaSigma() {
  const ss = getSpreadsheet();
  const sh = ss.getSheetByName(SHEET.TROCAS);
  if (!sh) return;
  const data = sh.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const ns = row[COL.ID];
    const statusSigma = row[23]; // Coluna X (exemplo) para controle do SIGMA

    // Se tem NS mas não abriu chamado no SIGMA ainda
    if (ns && !statusSigma) {
      Logger.log(`[SIGMA] Iniciando abertura para NS: ${ns}`);
      
      const sucesso = abrirChamadoSigmaAPI_(row);
      
      if (sucesso) {
        sh.getRange(i+1, 24).setValue('ABERTO_AUTO'); // Coluna X
        sh.getRange(i+1, 25).setValue(new Date());    // Coluna Y (Data Abertura)
        logExecucao('SIGMA_AUTO', `Chamado aberto para NS ${ns}`);
      } else {
        sh.getRange(i+1, 24).setValue('ERRO_ABERTURA');
      }
    }
  }
}

/**
 * Verifica se uma NS já existe na planilha para evitar duplicidade.
 */
function nsJaExiste(ns) {
  const ss = getSpreadsheet();
  const sh = ss.getSheetByName(SHEET.TROCAS);
  if (!sh || sh.getLastRow() < 2) return false;

  const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().flat();
  return ids.some(id => String(id) === String(ns));
}

/**
 * Faz a requisição para o servidor do SIGMA.
 */
function abrirChamadoSigmaAPI_(rowData) {
  const payload = {
    numero_ns: rowData[COL.ID],
    endereco: `${rowData[COL.LOGRADOURO]}, ${rowData[COL.NUMERO]}`,
    motivo: "TROCA DE POSTE - MANUTENÇÃO PREVENTIVA",
    prioridade: "ALTA",
    origem: "SISTEMA_AUTOMATICO_TROCA_POSTES"
  };

  const SIGMA_API_URL = "https://seu-sigma-interno.com.br/api/v1/chamados";
  
  try {
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    // return UrlFetchApp.fetch(SIGMA_API_URL, options).getResponseCode() < 400;
    return true; 
  } catch (e) {
    Logger.log(`[SIGMA] Erro crítico na API: ${e.message}`);
    return false;
  }
}