/**
 * SupabaseSync.gs
 * Sincroniza dados entre Google Sheets e Supabase (PostgreSQL).
 * 
 * Funcionalidades:
 *  - enviarNovasTrocasParaSupabase(): Puxa do Sheets → Upsert no Supabase
 *  - importarBaseRedeSupabase(): Puxa da rede no Supabase → Sheets (BASE_REDE)
 */

const SUPA_PROP = {
  URL: 'SUPABASE_URL',
  KEY: 'SUPABASE_ANON_KEY',
  TABLE_TROCAS: 'troca_postes_v2', // Tabela sugerida
};

/**
 * Envia as linhas da aba TROCAS para o Supabase.
 * Usa o ID como chave de conflito para fazer UPSERT.
 */
function enviarNovasTrocasParaSupabase() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty(SUPA_PROP.URL);
  const key = props.getProperty(SUPA_PROP.KEY);
  
  if (!url || !key) {
    Logger.log('[SupabaseSync] URL ou KEY não configurados.');
    return;
  }

  const ss = getSpreadsheet();
  const sh = ss.getSheetByName(SHEET.TROCAS);
  if (!sh) return;

  const data = sh.getDataRange().getValues();
  if (data.length < 2) return;

  const batchSize = 100;
  let currentBatch = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[COL.ID]) continue;

    const payload = {
      id: String(row[COL.ID]),
      data_troca: formatarDataISO_(row[COL.DATA_TROCA]),
      logradouro: String(row[COL.LOGRADOURO]),
      numero: String(row[COL.NUMERO]),
      bairro: String(row[COL.BAIRRO]),
      cidade: String(row[COL.CIDADE]),
      uf: String(row[COL.UF] || 'MG'),
      lat: row[COL.LAT] ? parseFloat(row[COL.LAT]) : null,
      lng: row[COL.LNG] ? parseFloat(row[COL.LNG]) : null,
      status: String(row[COL.STATUS]),
      responsavel: String(row[COL.RESPONSAVEL]),
      rede_status: String(row[COL.REDE_STATUS]),
      rede_dist_m: row[COL.REDE_DIST_M] ? parseInt(row[COL.REDE_DIST_M]) : null,
      rede_sigla: row[COL.REDE_SIGLA] || null,
      foto_url: row[COL.FOTO_URL] || null,
      updated_at: new Date().toISOString()
    };

    currentBatch.push(payload);

    if (currentBatch.length >= batchSize || i === data.length - 1) {
      upsertSupabase_(url, key, SUPA_PROP.TABLE_TROCAS, currentBatch);
      currentBatch = [];
    }
  }
}

/**
 * Helper para UPSERT via REST API do Supabase (PostgREST).
 */
function upsertSupabase_(baseUrl, key, table, data) {
  const url = `${baseUrl}/rest/v1/${table}`;
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Prefer': 'resolution=merge-duplicates'
    },
    payload: JSON.stringify(data),
    muteHttpExceptions: true
  };

  try {
    const resp = UrlFetchApp.fetch(url, options);
    if (resp.getResponseCode() >= 200 && resp.getResponseCode() < 300) {
      Logger.log(`[SupabaseSync] Upsert OK: ${data.length} registros.`);
    } else {
      Logger.log(`[SupabaseSync] Erro ${resp.getResponseCode()}: ${resp.getContentText()}`);
    }
  } catch (e) {
    Logger.log(`[SupabaseSync] Exceção: ${e.message}`);
  }
}

function formatarDataISO_(val) {
  if (!val) return null;
  const d = parseDate(val);
  if (!d || isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}
