// ============================================================
// ExportJSON.gs — Exporta dados para GitHub Pages (JSON)
// O site estático lê trocas.json via fetch().
// Push via GitHub Contents API (não precisa de git local).
// ============================================================

/**
 * Exporta aba TROCAS para JSON e faz push ao GitHub Pages.
 * Chamado automaticamente após cada processamento.
 */
function exportarParaGitHub() {
  const props = PropertiesService.getScriptProperties();
  const ghToken = props.getProperty(PROP.GH_TOKEN);
  const ghRepo  = props.getProperty(PROP.GH_REPO);
  const ghBranch = props.getProperty(PROP.GH_BRANCH) || 'main';

  if (!ghToken || !ghRepo) {
    Logger.log('[ExportJSON] GITHUB_TOKEN ou GITHUB_REPO não configurados. Exportação pulada.');
    return;
  }

  const json = buildTrocasJSON();
  const b64  = Utilities.base64Encode(json, Utilities.Charset.UTF_8);
  const path = 'site/data/trocas.json';
  const sha  = getFileSHA(ghToken, ghRepo, ghBranch, path);

  const payload = {
    message: `chore: atualiza trocas.json ${new Date().toISOString().slice(0,10)}`,
    content: b64,
    branch: ghBranch,
  };
  if (sha) payload.sha = sha; // necessário para update

  const url = `https://api.github.com/repos/${ghRepo}/contents/${path}`;
  try {
    const resp = UrlFetchApp.fetch(url, {
      method: 'put',
      headers: {
        'Authorization': `token ${ghToken}`,
        'Content-Type': 'application/json',
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = resp.getResponseCode();
    if (code === 200 || code === 201) {
      Logger.log(`[ExportJSON] Push OK → https://github.com/${ghRepo}/blob/${ghBranch}/${path}`);
      logExecucao('EXPORT_JSON', `Push GitHub OK: ${ghRepo}/${path}`);
    } else {
      Logger.log(`[ExportJSON] Erro ${code}: ${resp.getContentText().slice(0,200)}`);
    }
  } catch (e) {
    Logger.log(`[ExportJSON] Exceção: ${e.message}`);
  }
}

/**
 * Constrói o JSON com todos os dados relevantes para o mapa/dashboard.
 */
function buildTrocasJSON() {
  const ss = getSpreadsheet();
  const sh = ss.getSheetByName(SHEET.TROCAS);
  if (!sh || sh.getLastRow() < 2) return JSON.stringify({ trocas: [], gerado_em: new Date() });

  const data = sh.getDataRange().getValues();
  const trocas = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[COL.ID]) continue; // linha vazia
    trocas.push({
      id:           String(row[COL.ID]),
      data_troca:   fmtDate(row[COL.DATA_TROCA]),
      logradouro:   row[COL.LOGRADOURO],
      numero:       row[COL.NUMERO],
      bairro:       row[COL.BAIRRO],
      cidade:       row[COL.CIDADE],
      uf:           row[COL.UF] || 'MG',
      tipo_old:     row[COL.TIPO_POSTE_OLD],
      tipo_new:     row[COL.TIPO_POSTE_NEW],
      responsavel:  row[COL.RESPONSAVEL],
      status:       row[COL.STATUS],
      obs:          row[COL.OBS],
      lat:          row[COL.LAT]       ? parseFloat(row[COL.LAT]) : null,
      lng:          row[COL.LNG]       ? parseFloat(row[COL.LNG]) : null,
      geo_status:   row[COL.GEO_STATUS],
      rede_status:  row[COL.REDE_STATUS],
      rede_dist_m:  row[COL.REDE_DIST_M] ? parseInt(row[COL.REDE_DIST_M]) : null,
      rede_sigla:   row[COL.REDE_SIGLA]  || null,
      foto_url:     row[COL.FOTO_URL]    || null,
      dias_ate:     diasAte(row[COL.DATA_TROCA]),
    });
  }

  return JSON.stringify({
    trocas,
    gerado_em: new Date().toISOString(),
    total: trocas.length,
    por_status: contarPorStatus(trocas),
    por_rede: contarPorRede(trocas),
  }, null, 2);
}

function contarPorStatus(trocas) {
  return trocas.reduce((acc, t) => {
    acc[t.status || 'SEM_STATUS'] = (acc[t.status || 'SEM_STATUS'] || 0) + 1;
    return acc;
  }, {});
}

function contarPorRede(trocas) {
  return trocas.reduce((acc, t) => {
    acc[t.rede_status || 'N/A'] = (acc[t.rede_status || 'N/A'] || 0) + 1;
    return acc;
  }, {});
}

// Obtém SHA do arquivo atual no GitHub (necessário para update)
function getFileSHA(token, repo, branch, path) {
  try {
    const url = `https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`;
    const resp = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': `token ${token}` },
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() === 200) {
      return JSON.parse(resp.getContentText()).sha;
    }
  } catch (e) {}
  return null;
}
