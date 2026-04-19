// ============================================================
// Code.gs — Ponto de entrada principal TROCA-POSTES
// Orquestra: geocodificação → proximidade → alertas → export
// ============================================================

// ── Menu personalizado no Google Sheets ──────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔧 TROCA-POSTES')
    .addItem('⚙️ Inicializar planilha', 'inicializarPlanilha')
    .addSeparator()
    .addItem('▶️ Processar tudo', 'processarTudo')
    .addItem('📍 Geocodificar pendentes', 'geocodificarTodas')
    .addItem('🔗 Verificar proximidade rede', 'verificarProximidadeTodas')
    .addItem('📤 Exportar JSON → GitHub', 'exportarParaGitHub')
    .addSeparator()
    .addItem('🔔 Verificar e enviar alertas', 'verificarEEnviarAlertas')
    .addItem('🧪 Testar Telegram', 'testarTelegram')
    .addSeparator()
    .addItem('📥 Importar BASE_REDE (Supabase)', 'importarBaseRedeSupabase')
    .addItem('📥 Importar Telemont (aba TELEMONT)', 'importarDaTelemont')
    .addItem('✅ Marcar selecionado como EXECUTADO', 'marcarExecutado')
    .addSeparator()
    .addItem('🏢 Abrir chamados no SIGMA', 'processarAberturaSigma')
    .addSeparator()
    .addItem('⏰ Configurar triggers automáticos', 'configurarTriggers')
    .addItem('🗑️ Remover todos os triggers', 'removerTriggers')
    .addSeparator()
    .addItem('📊 Enviar Relatório Semanal', 'enviarRelatorioExecutivoSemanal')
    .addItem('🩺 Diagnóstico completo', 'diagnosticoCompleto')
    .addToUi();
}

/**
 * Ponto de entrada HTTP para o site estático atualizar status.
 * Use: <script-url>?action=executar&id=123
 */
function doGet(e) {
  const res = { status: 'error', message: 'Ação inválida' };
  
  try {
    const action = e.parameter.action;
    const id = e.parameter.id;
    
    if (action === 'executar' && id) {
      const ok = updateStatusById(id, 'EXECUTADO');
      if (ok) {
        res.status = 'success';
        res.message = `ID ${id} marcado como EXECUTADO`;
        // Dispara exportação em background para atualizar o site em 2-3 min
        exportarParaGitHub();
      } else {
        res.message = `ID ${id} não encontrado ou erro ao atualizar`;
      }
    }
  } catch (err) {
    res.message = err.message;
  }
  
  return ContentService.createTextOutput(JSON.stringify(res))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Ponto de entrada POST para upload de fotos (Evidência).
 function doPost(e) {
   const res = { status: 'error', message: 'Dados inválidos' };

   try {
     const data = JSON.parse(e.postData.contents);
     const action = data.action;

     // 1. Fluxo de Importação Automática (Outlook/PowerAutomate)
     if (action === 'importar_outlook') {
       const ns = data.ns;
       if (nsJaExiste(ns)) {
         res.message = `NS ${ns} já processada. Ignorando duplicata.`;
         return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
       }
       const ss = getSpreadsheet();
       const sh = ss.getSheetByName(SHEET.TROCAS);
       sh.appendRow([ns, data.data_prevista || new Date(), data.logradouro, data.numero || '', data.bairro || '', data.cidade || 'Belo Horizonte', 'MG', '', '', '', '', 'PENDENTE', 'Auto: Outlook']);
       res.status = 'success';
       res.message = `NS ${ns} importada com sucesso.`;
       processarAberturaSigma(); 
       return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
     }

     // 2. Fluxo de Emergência 🚨
     if (action === 'emergencia') {
       const token = getProp(PROP.TELEGRAM_TOKEN);
       const chat = getProp(PROP.TELEGRAM_CHATID);
       const mapsUrl = `https://www.google.com/maps?q=${data.lat},${data.lng}`;
       const texto = `🚨 *ALERTA DE EMERGÊNCIA*\n\n⚠️ *Ocorrência:* ${data.obs}\n👤 *Por:* ${data.usuario}\n📍 [Google Maps](${mapsUrl})`;
       sendTelegramMessage(token, chat, texto);
       if (data.foto) salvarFotoNoDrive(`EMERGENCIA_${Date.now()}`, data.foto, `emergencia_${Date.now()}.jpg`);
       res.status = 'success';
       res.message = 'Alerta processado.';
       return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
     }

     // 3. Fluxo normal de Evidência
     const id = data.id;
     if (id && data.base64) {
       const fileUrl = salvarFotoNoDrive(id, data.base64, data.filename || `troca_${id}.jpg`);
       if (fileUrl) {
         const gpsInfo = data.gps_lat ? ` [GPS: ${data.gps_lat.toFixed(5)}, ${data.gps_lng.toFixed(5)}]` : '';
         if (updateStatusById(id, 'EXECUTADO', fileUrl, gpsInfo)) {
           res.status = 'success';
           res.message = `ID ${id} finalizado.`;
           exportarParaGitHub();
         }
       }
     }
   } catch (err) {
     res.message = err.message;
   }
   return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
 }
/**
 * Salva imagem base64 no Google Drive.
 */
function salvarFotoNoDrive(id, base64, filename) {
  try {
    const folderId = getProp(PROP.DRIVE_FOLDER_ID, '');
    let folder;
    
    if (folderId) {
      folder = DriveApp.getFolderById(folderId);
    } else {
      // Cria pasta se não configurada
      const folders = DriveApp.getFoldersByName(SHEET.FOTOS_FOLDER);
      folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(SHEET.FOTOS_FOLDER);
      PropertiesService.getScriptProperties().setProperty(PROP.DRIVE_FOLDER_ID, folder.getId());
    }
    
    const contentType = base64.substring(base64.indexOf(":") + 1, base64.indexOf(";"));
    const bytes = Utilities.base64Decode(base64.split(",")[1]);
    const blob = Utilities.newBlob(bytes, contentType, filename);
    
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    
    return file.getUrl();
  } catch (e) {
    Logger.log(`[Upload] Erro ao salvar foto: ${e.message}`);
    return null;
  }
}

/**
 * Busca ID na aba TROCAS e atualiza status.
 */
function updateStatusById(id, newStatus, fotoUrl, gpsInfo) {
  const ss = getSpreadsheet();
  const sh = ss.getSheetByName(SHEET.TROCAS);
  if (!sh) return false;
  
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      const row = i + 2;
      sh.getRange(row, COL.STATUS + 1).setValue(newStatus);
      sh.getRange(row, COL.PROC_EM + 1).setValue(new Date());
      if (fotoUrl) {
        sh.getRange(row, COL.FOTO_URL + 1).setValue(fotoUrl);
      }
      if (gpsInfo) {
        const currentObs = sh.getRange(row, COL.OBS + 1).getValue();
        sh.getRange(row, COL.OBS + 1).setValue(`${currentObs}${gpsInfo}`);
      }
      return true;
    }
  }
  return false;
}

// ── Pipeline completo ─────────────────────────────────────────

/**
 * Executa o pipeline completo:
 * 1. Geocodifica todas as linhas sem coords
 * 2. Verifica proximidade da rede
 * 3. Envia alertas Telegram (D-1 / D0)
 * 4. Exporta JSON para GitHub Pages
 * 5. Atualiza timestamp PROC_EM
 */
function processarTudo() {
  Logger.log('[Main] === INICIO processarTudo ===');
  logExecucao('PROCESSAR_TUDO', 'Início do pipeline', 'INICIO');

  try {
    const ss = getSpreadsheet();
    const shObras = ss.getSheetByName(SHEET.OBRAS);

    // 1. Geocodificar Trocas e Obras
    Logger.log('[Main] Etapa 1: Geocodificação');
    geocodificarTodas();
    if (shObras) geocodificarAba_(shObras, [0,1,2,3,4,5,6]); // Adaptado para colunas da aba obras

    // 2. Verificar rede
    Logger.log('[Main] Etapa 2: Proximidade rede');
    verificarProximidadeTodas();
    if (shObras) verificarProximidadeAba_(shObras);

    // 3. Alertas Telegram (Somente Trocas por enquanto)
    Logger.log('[Main] Etapa 3: Alertas Telegram');
    verificarEEnviarAlertas();

    // 4. Export JSON + Sync
    Logger.log('[Main] Etapa 4: Export e Sync');
    exportarParaGitHub();
    enviarNovasTrocasParaSupabase();

    atualizarProcEm();
    logExecucao('PROCESSAR_TUDO', 'Pipeline completo concluído', 'OK');
  } catch (e) {
    logExecucao('PROCESSAR_TUDO', `ERRO: ${e.message}`, 'ERRO');
    throw e;
  }
}

/** Helper para processar qualquer aba de forma genérica */
function geocodificarAba_(sh, addrCols) {
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[12] === 'OK') continue; // GEO_STATUS
    geocodeRow(sh, i+1, row);
  }
}

function verificarProximidadeAba_(sh) {
  const shRede = getSpreadsheet().getSheetByName(SHEET.BASE_REDE);
  if (!shRede) return;
  const redeNodes = shRede.getRange(2, 1, shRede.getLastRow()-1, 4).getValues().filter(r => r[0] && r[1]);
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[13]) continue; // REDE_STATUS já preenchido
    checkNetworkProximity(sh, i+1, row, redeNodes);
  }
}

// ── Atualiza PROC_EM para todas as linhas processadas ─────────

function atualizarProcEm() {
  const ss = getSpreadsheet();
  const sh = ss.getSheetByName(SHEET.TROCAS);
  if (!sh) return;
  const now = new Date();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return;
  sh.getRange(2, COL.PROC_EM+1, lastRow-1, 1).setValue(now);
}

// ── Triggers automáticos ──────────────────────────────────────

/**
 * Configura triggers:
 * - Todo dia às 07:00 → processarTudo (alertas D0 + pipeline)
 * - Todo dia às 23:00 → verificarEEnviarAlertas (alertas D-1)
 * Execute uma única vez após o setup.
 */
function configurarTriggers() {
  // Remove triggers existentes primeiro
  removerTriggers();

  // Trigger diário 07:00
  ScriptApp.newTrigger('processarTudo')
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .inTimezone('America/Sao_Paulo')
    .create();

  // Trigger diário 23:00 (D-1 para amanhã)
  ScriptApp.newTrigger('verificarEEnviarAlertas')
    .timeBased()
    .everyDays(1)
    .atHour(23)
    .inTimezone('America/Sao_Paulo')
    .create();

  Logger.log('[Main] Triggers configurados: 07:00 (processarTudo) e 23:00 (alertas D-1)');
  SpreadsheetApp.getUi().alert(
    '✅ Triggers configurados!\n\n• 07:00 — pipeline completo (D0)\n• 23:00 — alerta véspera (D-1)'
  );
}

function removerTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log('[Main] Todos os triggers removidos');
}

// ── Trigger de edição (atualiza geocoding ao editar endereço) ─

function onEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  if (sh.getName() !== SHEET.TROCAS) return;

  const col = e.range.getColumn() - 1; // 0-based
  const row = e.range.getRow();
  if (row <= 1) return; // cabeçalho

  const newValue = e.value;

  // 1. Se alterou Status para EXECUTADO: Notifica e Sincroniza
  if (col === COL.STATUS && newValue === 'EXECUTADO') {
    const rowData = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
    const id = rowData[COL.ID];
    const resp = rowData[COL.RESPONSAVEL] || 'técnico';
    
    // Alerta imediato no Telegram
    const msg = `✅ *TROCA CONCLUÍDA*\n\nID: #${id}\nLocal: ${rowData[COL.LOGRADOURO]}\nResponsável: ${resp}\n🕒 ${new Date().toLocaleString('pt-BR')}`;
    try {
      const token = getProp(PROP.TELEGRAM_TOKEN);
      const chat  = getProp(PROP.TELEGRAM_CHATID);
      sendTelegramMessage(token, chat, msg);
    } catch(err) {}

    // Atualiza o site e Supabase
    sh.getRange(row, COL.PROC_EM + 1).setValue(new Date());
    exportarParaGitHub();
    enviarNovasTrocasParaSupabase();
  }

  // 2. Se editou endereço: limpa geocoding para forçar reprocessamento
  const addrCols = [COL.LOGRADOURO, COL.NUMERO, COL.BAIRRO, COL.CIDADE, COL.UF, COL.CEP];
  if (addrCols.includes(col)) {
    sh.getRange(row, COL.LAT+1, 1, 4).clearContent(); // limpa LAT, LNG, GEO_STATUS, REDE_STATUS
  }
}
