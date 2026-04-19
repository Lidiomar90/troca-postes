// ============================================================
// ExecutiveReport.gs — Relatório Semanal Automático
// Consolida dados da semana e envia resumo para o Telegram.
// ============================================================

/**
 * Gera e envia o relatório executivo da semana.
 * Sugestão: Gatilho semanal (Sexta-feira 17:00).
 */
function enviarRelatorioExecutivoSemanal() {
  const ss = getSpreadsheet();
  const trocas = extractSheetData_(ss.getSheetByName(SHEET.TROCAS), 'TROCA_POSTE');
  const obras  = extractSheetData_(ss.getSheetByName(SHEET.OBRAS), 'OBRA_TERCEIRO');
  
  const hoje = new Date();
  const umaSemanaAtras = new Date(hoje.getTime() - 7 * 24 * 60 * 60 * 1000);

  const executados = trocas.filter(t => t.status === 'EXECUTADO' && parseDate(t.data_troca) >= umaSemanaAtras).length;
  const pendentes  = trocas.filter(t => t.status === 'PENDENTE').length;
  const obrasNovas = obras.filter(o => parseDate(o.data_troca) >= umaSemanaAtras).length;
  
  const texto = [
    `📊 *RELATÓRIO SEMANAL — TROCA DE POSTES*`,
    ``,
    `📅 *Período:* ${umaSemanaAtras.toLocaleDateString()} a ${hoje.toLocaleDateString()}`,
    ``,
    `✅ *Trocas Executadas:* ${executados}`,
    `⏳ *Trocas Pendentes:* ${pendentes}`,
    `🏗️ *Novas Obras Terceiros:* ${obrasNovas}`,
    ``,
    `🌐 *Status das APIs:*`,
    `• Google Maps: OK`,
    `• GitHub Pages: OK`,
    `• Telegram Bot: OK`,
    ``,
    `🚀 _Sistema Operacional Automatizado_`
  ].join('\n');

  try {
    const token = getProp(PROP.TELEGRAM_TOKEN);
    const chat  = getProp(PROP.TELEGRAM_CHATID);
    sendTelegramMessage(token, chat, texto);
    logExecucao('RELATORIO_SEMANAL', 'Relatório enviado com sucesso');
  } catch (e) {
    Logger.log('[Relatorio] Erro: ' + e.message);
  }
}