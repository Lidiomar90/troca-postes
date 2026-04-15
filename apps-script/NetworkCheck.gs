// ============================================================
// NetworkCheck.gs — Verifica proximidade com a rede óptica
// Fonte: aba BASE_REDE (lat, lng, sigla, tipo)
// Fórmula: Haversine (distância em metros entre dois pontos)
// ============================================================

/**
 * Verifica proximidade da rede para uma troca.
 * Atualiza REDE_STATUS e REDE_DIST_M na planilha.
 * 
 * @param {Sheet} shTrocas
 * @param {number} row - 1-based
 * @param {Array} rowData
 * @param {Array[]} redeNodes - cache da BASE_REDE (pontos)
 */
function checkNetworkProximity(shTrocas, row, rowData, redeNodes) {
  const lat = parseFloat(rowData[COL.LAT]);
  const lng = parseFloat(rowData[COL.LNG]);

  if (isNaN(lat) || isNaN(lng)) {
    setCellValue(shTrocas, row, COL.REDE_STATUS, 'SEM_COORDS');
    return;
  }

  // Se já tiver status "REDE PRÓXIMA", mantém (opcional: recalcular se houver novos dados)
  // const existingStatus = rowData[COL.REDE_STATUS];
  // if (existingStatus === 'REDE PRÓXIMA') return;

  if (!redeNodes || redeNodes.length === 0) {
    setCellValue(shTrocas, row, COL.REDE_STATUS, 'BASE_REDE_VAZIA');
    return;
  }

  let minDist = Infinity;
  let closestSigla = '';

  // 1. Verificação contra pontos (Sites/Caixas/Postes de rede)
  for (const node of redeNodes) {
    const nLat = parseFloat(node[0]);
    const nLng = parseFloat(node[1]);
    if (isNaN(nLat) || isNaN(nLng)) continue;
    
    const d = haversineMeters(lat, lng, nLat, nLng);
    if (d < minDist) {
      minDist = d;
      closestSigla = node[2] || '';
    }
  }

  // 2. TODO: Implementar verificação contra Polylines (Segmentos de cabo)
  // Requer uma nova aba ou fonte de dados GeoJSON de cabos no Apps Script.

  let status;
  if (minDist <= PROX.REDE_PROXIMA) {
    status = 'REDE PRÓXIMA';
  } else if (minDist <= PROX.ATENCAO) {
    status = 'ATENÇÃO';
  } else {
    status = 'SEM REDE';
  }

  // Só atualiza se o status mudou ou se estava vazio
  if (rowData[COL.REDE_STATUS] !== status || rowData[COL.REDE_DIST_M] != Math.round(minDist)) {
    setCellValue(shTrocas, row, COL.REDE_STATUS, status);
    setCellValue(shTrocas, row, COL.REDE_DIST_M, Math.round(minDist));
    if (closestSigla) {
      setCellValue(shTrocas, row, COL.REDE_SIGLA, closestSigla);
    }
    Logger.log(`[NetworkCheck] Linha ${row}: ${status} (${Math.round(minDist)}m de ${closestSigla})`);
  }
}

/**
 * Verifica proximidade para TODAS as linhas sem REDE_STATUS.
 * Carrega BASE_REDE uma vez em memória para eficiência.
 */
function verificarProximidadeTodas() {
  const ss = getSpreadsheet();
  const shTrocas = ss.getSheetByName(SHEET.TROCAS);
  const shRede   = ss.getSheetByName(SHEET.BASE_REDE);

  if (!shTrocas) { Logger.log('[NetworkCheck] Aba TROCAS não encontrada'); return; }

  // Carrega BASE_REDE (sem cabeçalho)
  let redeNodes = [];
  if (shRede && shRede.getLastRow() > 1) {
    redeNodes = shRede.getRange(2, 1, shRede.getLastRow()-1, 4).getValues()
      .filter(r => r[0] && r[1]); // lat e lng obrigatórios
    Logger.log(`[NetworkCheck] BASE_REDE: ${redeNodes.length} nós carregados`);
  } else {
    Logger.log('[NetworkCheck] AVISO: BASE_REDE vazia ou ausente. Importe os nós primeiro.');
  }

  const data = shTrocas.getDataRange().getValues();
  let updated = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[COL.STATUS] === 'CANCELADO') continue;
    if (row[COL.GEO_STATUS] !== 'OK') continue;

    checkNetworkProximity(shTrocas, i+1, row, redeNodes);
    updated++;
  }

  const msg = `[NetworkCheck] ${updated} linhas verificadas`;
  Logger.log(msg);
  logExecucao('VERIFICAR_PROXIMIDADE', msg);
}

/**
 * Importa nós da rede a partir do Supabase (opcional).
 * Requer SUPABASE_URL e SUPABASE_ANON_KEY nas Script Properties.
 * Preenche a aba BASE_REDE com lat,lng,sigla,tipo.
 */
function importarBaseRedeSupabase() {
  const props = PropertiesService.getScriptProperties();
  const supabaseUrl = props.getProperty('SUPABASE_URL');
  const supabaseKey = props.getProperty('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !supabaseKey) {
    Logger.log('[NetworkCheck] SUPABASE_URL / SUPABASE_ANON_KEY não configurados. Importe manualmente a BASE_REDE.');
    return;
  }

  try {
    const url = `${supabaseUrl}/rest/v1/network_nodes?select=lat,lng,sigla,tipo_ativo&tipo_ativo=eq.site&limit=10000`;
    const resp = UrlFetchApp.fetch(url, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      },
      muteHttpExceptions: true
    });

    if (resp.getResponseCode() !== 200) {
      Logger.log(`[NetworkCheck] Supabase erro ${resp.getResponseCode()}`);
      return;
    }

    const nodes = JSON.parse(resp.getContentText())
      .filter(n => n.lat && n.lng);

    const ss = getSpreadsheet();
    const sh = getOrCreateSheet(ss, SHEET.BASE_REDE);

    // Cabeçalho
    sh.clearContents();
    sh.getRange(1,1,1,4).setValues([['lat','lng','sigla','tipo']]);

    // Dados
    const rows = nodes.map(n => [n.lat, n.lng, n.sigla, n.tipo_ativo]);
    if (rows.length > 0) {
      sh.getRange(2, 1, rows.length, 4).setValues(rows);
    }

    const msg = `[NetworkCheck] BASE_REDE importada: ${rows.length} nós`;
    Logger.log(msg);
    logExecucao('IMPORTAR_BASE_REDE', msg);

  } catch (e) {
    Logger.log(`[NetworkCheck] Erro ao importar: ${e.message}`);
  }
}

// ── Fórmula Haversine ─────────────────────────────────────────
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000; // raio da Terra em metros
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2)
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2))
          * Math.sin(dLng/2) * Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
