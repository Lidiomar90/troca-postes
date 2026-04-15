const APP_SECURITY = Object.freeze({
  REQUIRED_KEYS: ['TELEGRAM_TOKEN','TELEGRAM_CHAT_ID','GITHUB_TOKEN','GITHUB_REPO','GITHUB_BRANCH'],
  DEFAULT_ALLOWED_BRANCHES: ['main'],
  DEFAULT_ALLOWED_PATHS: ['site/','docs/','data/']
});

function getScriptProps_() {
  return PropertiesService.getScriptProperties();
}

function getRequiredProperty_(key) {
  const value = getScriptProps_().getProperty(key);
  if (!value) throw new Error('Configuração obrigatória ausente: ' + key);
  return String(value).trim();
}

function getOptionalProperty_(key, fallbackValue) {
  const value = getScriptProps_().getProperty(key);
  return value == null || value === '' ? fallbackValue : String(value).trim();
}

function getAllowedBranches_() {
  const raw = getOptionalProperty_('ALLOWED_DEPLOY_BRANCHES', '');
  return raw ? raw.split(',').map(String).map(function(v){return v.trim();}).filter(String) : APP_SECURITY.DEFAULT_ALLOWED_BRANCHES.slice();
}

function getAllowedPaths_() {
  const raw = getOptionalProperty_('ALLOWED_GITHUB_PATHS', '');
  return raw ? raw.split(',').map(String).map(function(v){return v.trim();}).filter(String) : APP_SECURITY.DEFAULT_ALLOWED_PATHS.slice();
}

function assertAllowedBranch_(branchName) {
  if (getAllowedBranches_().indexOf(String(branchName)) === -1) {
    throw new Error('Branch não autorizada para publicação: ' + branchName);
  }
}

function assertAllowedPath_(targetPath) {
  const cleanPath = String(targetPath || '').replace(/^\/+/, '');
  const ok = getAllowedPaths_().some(function(prefix) { return cleanPath.indexOf(prefix) === 0; });
  if (!ok) throw new Error('Caminho não autorizado para publicação: ' + cleanPath);
}

function validateSecurityConfig() {
  const props = getScriptProps_().getProperties();
  const missing = APP_SECURITY.REQUIRED_KEYS.filter(function(k){ return !props[k]; });
  return {
    ok: missing.length === 0,
    missing: missing,
    allowedBranches: getAllowedBranches_(),
    allowedPaths: getAllowedPaths_()
  };
}
