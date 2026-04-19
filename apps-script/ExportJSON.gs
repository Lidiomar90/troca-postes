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
  const shTrocas = ss.getSheetByName(SHEET.TROCAS);
  const shObras = ss.getSheetByName(SHEET.OBRAS);
  
  const trocas = extractSheetData_(shTrocas, 'TROCA_POSTE');
  const obras = extractSheetData_(shObras, 'OBRA_TERCEIRO');

  const allData = [...trocas, ...obras];

  return JSON.stringify({
    trocas: allData,
    gerado_em: new Date().toISOString(),
    total: allData.length,
    por_status: contarPorStatus(allData),
    por_rede: contarPorRede(allData),
    stats: {
      trocas: trocas.length,
      obras: obras.length
    }
  }, null, 2);
}

function extractSheetData_(sh, tipo) {
  if (!sh || sh.getLastRow() < 2) return [];
  const data = sh.getDataRange().getValues();
  const results = [];
  
  // Mapeamento dinâmico básico baseado no tipo
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    
    results.push({
      id:           String(row[0]),
      tipo_reg:     tipo,
      data_troca:   fmtDate(row[1]),
      logradouro:   row[2],
      numero:       row[3],
      bairro:       row[4],
      cidade:       row[5],
      uf:           row[6] || 'MG',
      responsavel:  tipo === 'TROCA_POSTE' ? row[10] : row[7],
      status:       tipo === 'TROCA_POSTE' ? row[11] : row[8],
      obs:          tipo === 'TROCA_POSTE' ? row[12] : row[9],
      lat:          tipo === 'TROCA_POSTE' ? (row[13] ? parseFloat(row[13]) : null) : (row[10] ? parseFloat(row[10]) : null),
      lng:          tipo === 'TROCA_POSTE' ? (row[14] ? parseFloat(row[14]) : null) : (row[11] ? parseFloat(row[11]) : null),
      geo_status:   tipo === 'TROCA_POSTE' ? row[15] : row[12],
      rede_status:  tipo === 'TROCA_POSTE' ? row[16] : row[13],
      rede_dist_m:  tipo === 'TROCA_POSTE' ? (row[17] ? parseInt(row[17]) : null) : (row[14] ? parseInt(row[14]) : null),
      dias_ate:     diasAte(row[1]),
    });
  }
  return results;
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
