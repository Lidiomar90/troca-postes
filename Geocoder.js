// ============================================================
// Geocoder.gs — Geocodificação de endereços (MG / Brasil)
// Estratégia: Google Maps Service (nativo Apps Script) com
// fallback para Nominatim (OpenStreetMap, gratuito).
// Rate limit Nominatim: 1 req/s → este script usa sleep(1100).
// ============================================================

/**
 * Geocodifica uma linha da aba TROCAS.
 * Atualiza diretamente as colunas LAT, LNG, GEO_STATUS.
 * @param {Sheet} sh - aba TROCAS
 * @param {number} row - número da linha (1-based)
 * @param {Array} rowData - dados da linha (0-based)
 * @returns {{lat:number, lng:number, status:string}}
 */
function geocodeRow(sh, row, rowData) {
  // Já geocodificado com sucesso? Pula.
  if (rowData[COL.GEO_STATUS] === 'OK' &&
      rowData[COL.LAT] && rowData[COL.LNG]) {
    return { lat: rowData[COL.LAT], lng: rowData[COL.LNG], status: 'OK' };
  }

  const addr = buildAddress(rowData);
  if (!addr) {
    setCellValue(sh, row, COL.GEO_STATUS, 'SEM_ENDERECO');
    return { lat: null, lng: null, status: 'SEM_ENDERECO' };
  }

  // Tentativa 1: Google Maps API (nativa, sem custo em Apps Script)
  let result = geocodeGoogleMaps(addr);

  // Tentativa 2: Nominatim (fallback)
  if (!result) result = geocodeNominatim(addr);

  if (result) {
    setCellValue(sh, row, COL.LAT, result.lat);
    setCellValue(sh, row, COL.LNG, result.lng);
    setCellValue(sh, row, COL.GEO_STATUS, 'OK');
    Logger.log(`[Geocoder] OK: "${addr}" → ${result.lat}, ${result.lng}`);
    return { lat: result.lat, lng: result.lng, status: 'OK' };
  } else {
    setCellValue(sh, row, COL.GEO_STATUS, 'FALHOU');
    Logger.log(`[Geocoder] FALHOU: "${addr}"`);
    return { lat: null, lng: null, status: 'FALHOU' };
  }
}

/**
 * Geocodifica TODAS as linhas sem lat/lng em lote.
 * Chame manualmente pelo menu ou via trigger semanal.
 */
function geocodificarTodas() {
  const ss = getSpreadsheet();
  const sh = ss.getSheetByName(SHEET.TROCAS);
  if (!sh) { Logger.log('[Geocoder] Aba TROCAS não encontrada'); return; }

  const data = sh.getDataRange().getValues();
  let ok = 0, fail = 0, skip = 0;

  for (let i = 1; i < data.length; i++) { // pula cabeçalho
    const row = data[i];
    const status = row[COL.STATUS];
    if (status === 'CANCELADO') { skip++; continue; }
    if (row[COL.GEO_STATUS] === 'OK') { skip++; continue; }

    const res = geocodeRow(sh, i + 1, row);
    if (res.status === 'OK') ok++;
    else if (res.status === 'FALHOU') fail++;
    else skip++;

    // Rate limit: aguarda 300ms entre requests Google Maps
    Utilities.sleep(300);
  }

  const msg = `[Geocoder] Concluído: ${ok} OK, ${fail} falhou, ${skip} pulados`;
  Logger.log(msg);
  logExecucao('GEOCODIFICAR_TODAS', msg);
}

// ── Helpers ──────────────────────────────────────────────────

function buildAddress(rowData) {
  const parts = [
    rowData[COL.LOGRADOURO],
    rowData[COL.NUMERO],
    rowData[COL.BAIRRO],
    rowData[COL.CIDADE] || 'Minas Gerais',
    rowData[COL.UF]     || 'MG',
    'Brasil'
  ].filter(Boolean).map(String).filter(s => s.trim());

  return parts.length >= 2 ? parts.join(', ') : '';
}

function geocodeGoogleMaps(address) {
  try {
    const geocoder = Maps.newGeocoder().setRegion('br');
    const response = geocoder.geocode(address);
    if (response.status === 'OK' && response.results.length > 0) {
      const loc = response.results[0].geometry.location;
      return { lat: loc.lat, lng: loc.lng };
    }
  } catch (e) {
    Logger.log(`[Geocoder] Google Maps erro: ${e.message}`);
  }
  return null;
}

function geocodeNominatim(address) {
  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q='
                + encodeURIComponent(address);
    const resp = UrlFetchApp.fetch(url, {
      headers: { 'User-Agent': 'TrocaPostes/1.0 (lidiomar90@gmail.com)' },
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() === 200) {
      const data = JSON.parse(resp.getContentText());
      if (data.length > 0) {
        return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      }
    }
    // Rate limit: 1 req/s
    Utilities.sleep(1100);
  } catch (e) {
    Logger.log(`[Geocoder] Nominatim erro: ${e.message}`);
  }
  return null;
}

function setCellValue(sh, row, colIndex, value) {
  sh.getRange(row, colIndex + 1).setValue(value);
}
