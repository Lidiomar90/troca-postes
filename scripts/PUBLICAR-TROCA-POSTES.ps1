#Requires -Version 5.1
<#
.SYNOPSIS
  Publica site estático no GitHub Pages com tratamento robusto de erros.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$HOST.UI.RawUI.WindowTitle = 'PUBLICAR TROCA-POSTES'

$ROOT  = $PSScriptRoot
$PRIV  = Join-Path $ROOT 'privado'

function Write-OK   { param($m) Write-Host "  [OK] $m" -ForegroundColor Green }
function Write-Warn { param($m) Write-Host "  [AVISO] $m" -ForegroundColor Yellow }
function Write-Fail { param($m) Write-Host "  [ERRO] $m" -ForegroundColor Red }
function Write-Step { param($m) Write-Host "`n  >> $m" -ForegroundColor White }

Write-Host ""
Write-Host "  =============================================" -ForegroundColor Cyan
Write-Host "  PUBLICAR TROCA-POSTES — GitHub Pages" -ForegroundColor Cyan
Write-Host "  =============================================" -ForegroundColor Cyan

# Carrega token
$ghToken = ''
$ghRepo  = 'Lidiomar90/troca-postes'
$ghBranch = 'main'

$tokenFile = Join-Path $PRIV '.github_token'
if (Test-Path $tokenFile) {
  $ghToken = (Get-Content $tokenFile -Raw).Trim()
  Write-OK "Token GitHub carregado"
} else {
  Write-Warn "privado\.github_token não encontrado. Push autenticado não disponível."
}

$confFile = Join-Path $PRIV '.github_config'
if (Test-Path $confFile) {
  $gc = Get-Content $confFile | ConvertFrom-StringData
  if ($gc['REPO'])   { $ghRepo   = $gc['REPO'] }
  if ($gc['BRANCH']) { $ghBranch = $gc['BRANCH'] }
}

Set-Location $ROOT

# ── Verifica git ──────────────────────────────────────────────
Write-Step "Verificando repositório git..."
$gitStatus = git status 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Fail "Repositório git inválido. Execute SETUP-COMPLETO.ps1 primeiro."
  Read-Host "Pressione Enter para sair"; exit 1
}

# ── Staging seletivo ──────────────────────────────────────────
Write-Step "Preparando staging..."

$arquivosParaCommit = @(
  'site/index.html',
  'site/data/trocas.json',
  'apps-script/Code.gs',
  'apps-script/Config.gs',
  'apps-script/SheetSync.gs',
  'apps-script/Geocoder.gs',
  'apps-script/NetworkCheck.gs',
  'apps-script/TelegramAlert.gs',
  'apps-script/ExportJSON.gs',
  'apps-script/Diagnostico.gs',
  'apps-script/appsscript.json',
  'apps-script/.clasp.json',
  'CONFIGURAR.md',
  '.gitignore',
  'SETUP-COMPLETO.ps1',
  'VALIDAR-CONFIGURACAO.ps1',
  'MONITORAR.ps1',
  'PUBLICAR-TROCA-POSTES.ps1',
  'PUBLICAR-TROCA-POSTES.bat',
  'PUSH-CLASP.bat',
  'AGENDAR-MONITOR.bat'
)

foreach ($arq in $arquivosParaCommit) {
  $p = Join-Path $ROOT $arq
  if (Test-Path $p) {
    git add $p 2>&1 | Out-Null
  }
}

# Verifica se há algo para commitar
$staged = git diff --cached --name-only 2>&1
if (-not $staged) {
  Write-OK "Nenhuma alteração local para commitar."
} else {
  Write-Host "  Arquivos a commitar:" -ForegroundColor Gray
  $staged | ForEach-Object { Write-Host "    - $_" -ForegroundColor Gray }

  $data = Get-Date -Format 'yyyy-MM-dd HH:mm'
  $msg  = "chore: atualiza site e scripts $data"
  git commit -m $msg 2>&1 | Out-Null
  Write-OK "Commit criado: $msg"
}

# ── Push para GitHub ──────────────────────────────────────────
Write-Step "Publicando no GitHub ($ghRepo)..."

git config http.version HTTP/1.1
git config http.postBuffer 52428800

$remoteUrl = if ($ghToken) {
  "https://$ghToken@github.com/$ghRepo.git"
} else {
  "https://github.com/$ghRepo.git"
}

$pushOut = git push $remoteUrl $ghBranch 2>&1
if ($LASTEXITCODE -eq 0) {
  Write-OK "Push concluído!"
  $siteUrl = "https://$($ghRepo.Split('/')[0].ToLower()).github.io/$($ghRepo.Split('/')[1])/site/"
  Write-Host ""
  Write-Host "  =============================================" -ForegroundColor Cyan
  Write-Host "  Site: $siteUrl" -ForegroundColor Green
  Write-Host "  =============================================" -ForegroundColor Cyan
} else {
  Write-Fail "Erro no push:`n$pushOut"
  Write-Host "  Dicas de troubleshooting:" -ForegroundColor Yellow
  Write-Host "    1. Verifique se privado\.github_token está correto" -ForegroundColor Gray
  Write-Host "    2. Confirme que o repo $ghRepo existe no GitHub" -ForegroundColor Gray
  Write-Host "    3. Verifique permissões do token (Contents: Read+Write)" -ForegroundColor Gray
}
Write-Host ""
Read-Host "  Pressione Enter para fechar"
