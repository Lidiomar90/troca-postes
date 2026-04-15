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
    .addItem('⏰ Configurar triggers automáticos', 'configurarTriggers')
    .addItem('🗑️ Remover todos os triggers', 'removerTriggers')
    .addSeparator()
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
 */
function doPost(e) {
  const res = { status: 'error', message: 'Dados inválidos' };
  
  try {
    const data = JSON.parse(e.postData.contents);
    const id = data.id;
    const base64 = data.base64; // Dados da imagem em base64
    const filename = data.filename || `troca_${id}_${new Date().getTime()}.jpg`;
    
    if (id && base64) {
      const fileUrl = salvarFotoNoDrive(id, base64, filename);
      if (fileUrl) {
        // Log do GPS nas observações ou em colunas extras se desejar
        const gpsInfo = data.gps_lat ? ` [GPS: ${data.gps_lat.toFixed(5)}, ${data.gps_lng.toFixed(5)} | Dist: ${data.gps_distancia}m]` : '';
        const ok = updateStatusById(id, 'EXECUTADO', fileUrl, gpsInfo);
        if (ok) {
          res.status = 'success';
          res.message = `ID ${id} finalizado com evidência e GPS.`;
          exportarParaGitHub();
          enviarNovasTrocasParaSupabase();
        }
      }
    }
  } catch (err) {
    res.message = err.message;
  }
  
  return ContentService.createTextOutput(JSON.stringify(res))
    .setMimeType(ContentService.MimeType.JSON);
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
    // 0. Diagnóstico rápido (loga avisos, não bloqueia)
    const avisos = diagnosticoRapido();
    if (avisos.length > 0) {
      Logger.log('[Main] Avisos de configuração: ' + avisos.join('; '));
    }

    // 1. Geocodificar
    Logger.log('[Main] Etapa 1/4: Geocodificação');
    geocodificarTodas();

    // 2. Verificar rede
    Logger.log('[Main] Etapa 2/4: Proximidade rede');
    verificarProximidadeTodas();

    // 3. Alertas Telegram
    Logger.log('[Main] Etapa 3/4: Alertas Telegram');
    verificarEEnviarAlertas();

    // 4. Export JSON
    Logger.log('[Main] Etapa 4/5: Export JSON → GitHub');
    exportarParaGitHub();

    // 5. Sync Supabase
    Logger.log('[Main] Etapa 5/5: Sync Supabase');
    enviarNovasTrocasParaSupabase();

    // 6. Timestamp final
    atualizarProcEm();

    logExecucao('PROCESSAR_TUDO', 'Pipeline concluído com sucesso', 'OK');
    Logger.log('[Main] === FIM processarTudo ===');

  } catch (e) {
    logExecucao('PROCESSAR_TUDO', `ERRO: ${e.message}`, 'ERRO');
    Logger.log(`[Main] ERRO no pipeline: ${e.message}\n${e.stack}`);
    throw e;
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
  // Só reage a edições na aba TROCAS
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  if (sh.getName() !== SHEET.TROCAS) return;

  const col = e.range.getColumn() - 1; // 0-based
  const row = e.range.getRow();
  if (row <= 1) return; // cabeçalho

  // Se editou endereço: limpa geocoding para forçar reprocessamento
  const addrCols = [COL.LOGRADOURO, COL.NUMERO, COL.BAIRRO, COL.CIDADE, COL.UF, COL.CEP];
  if (addrCols.includes(col)) {
    sh.getRange(row, COL.LAT+1).clearContent();
    sh.getRange(row, COL.LNG+1).clearContent();
    sh.getRange(row, COL.GEO_STATUS+1).clearContent();
    sh.getRange(row, COL.REDE_STATUS+1).clearContent();
    sh.getRange(row, COL.REDE_DIST_M+1).clearContent();
  }
}
