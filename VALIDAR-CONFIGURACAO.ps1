#Requires -Version 5.1
<#
.SYNOPSIS
  VALIDAR-CONFIGURACAO.ps1 — Checklist completo antes de usar o sistema
  Execute a qualquer momento para verificar se tudo está OK.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$HOST.UI.RawUI.WindowTitle = 'VALIDAR TROCA-POSTES'

$ROOT  = $PSScriptRoot
$PRIV  = Join-Path $ROOT 'privado'

# ── Helpers ───────────────────────────────────────────────────
$script:totalOK   = 0
$script:totalWarn = 0
$script:totalFail = 0

function Check-OK   { param($m) Write-Host "  ✅ $m" -ForegroundColor Green;  $script:totalOK++   }
function Check-Warn { param($m) Write-Host "  ⚠️  $m" -ForegroundColor Yellow; $script:totalWarn++ }
function Check-Fail { param($m) Write-Host "  ❌ $m" -ForegroundColor Red;    $script:totalFail++ }
function Section    { param($m) Write-Host "`n  ── $m ──" -ForegroundColor Cyan }

# ═══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║   VALIDAÇÃO DE CONFIGURAÇÃO — TROCA-POSTES  ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ═══════════════════════════════════════════════════════════════
Section "PRÉ-REQUISITOS"

# Node.js
$nodeVer = node --version 2>&1
if ($LASTEXITCODE -eq 0) { Check-OK "Node.js: $nodeVer" }
else { Check-Fail "Node.js não instalado → https://nodejs.org" }

# clasp
$claspVer = clasp --version 2>&1
if ($LASTEXITCODE -eq 0) { Check-OK "clasp: $claspVer" }
else { Check-Fail "clasp não instalado → npm install -g @google/clasp" }

# clasp autenticado
$claspAuth = Join-Path $env:APPDATA 'clasp\oauth2.json'
if (Test-Path $claspAuth) { Check-OK "clasp autenticado (oauth2.json presente)" }
else { Check-Warn "clasp não autenticado → execute: clasp login" }

# git
$gitVer = git --version 2>&1
if ($LASTEXITCODE -eq 0) { Check-OK "git: $gitVer" }
else { Check-Fail "git não instalado → https://git-scm.com" }

# gh CLI
$ghVer = gh --version 2>&1 | Select-Object -First 1
if ($LASTEXITCODE -eq 0) { Check-OK "GitHub CLI: $ghVer" }
else { Check-Warn "GitHub CLI não instalado (opcional) → https://cli.github.com" }

# PowerShell version
$psVer = $PSVersionTable.PSVersion
if ($psVer.Major -ge 5) { Check-OK "PowerShell: $psVer" }
else { Check-Warn "PowerShell $psVer (recomendado 5.1+)" }

# ═══════════════════════════════════════════════════════════════
Section "ARQUIVOS DO PROJETO"

$arquivosEsperados = @(
  'apps-script\Code.gs',
  'apps-script\Config.gs',
  'apps-script\SheetSync.gs',
  'apps-script\Geocoder.gs',
  'apps-script\NetworkCheck.gs',
  'apps-script\TelegramAlert.gs',
  'apps-script\ExportJSON.gs',
  'apps-script\Diagnostico.gs',
  'apps-script\appsscript.json',
  'apps-script\.clasp.json',
  'site\index.html',
  'site\data\trocas.json',
  'CONFIGURAR.md',
  '.gitignore',
  'SETUP-COMPLETO.ps1',
  'MONITORAR.ps1'
)

foreach ($arq in $arquivosEsperados) {
  $path = Join-Path $ROOT $arq
  if (Test-Path $path) { Check-OK $arq }
  else { Check-Fail "Ausente: $arq" }
}

# ── .clasp.json tem scriptId real ────────────────────────────
$claspJson = Join-Path $ROOT 'apps-script\.clasp.json'
if (Test-Path $claspJson) {
  $cj = Get-Content $claspJson | ConvertFrom-Json
  if ($cj.scriptId -eq 'COLE_AQUI_O_SCRIPT_ID') {
    Check-Fail ".clasp.json: scriptId não configurado → siga CONFIGURAR.md etapa 3"
  } elseif ($cj.scriptId.Length -gt 20) {
    Check-OK ".clasp.json: scriptId = $($cj.scriptId.Substring(0,12))..."
  } else {
    Check-Warn ".clasp.json: scriptId parece inválido: $($cj.scriptId)"
  }
}

# ── Pasta privado/ e tokens ───────────────────────────────────
Section "CREDENCIAIS (pasta privado/)"

if (-not (Test-Path $PRIV)) {
  Check-Fail "Pasta privado/ não existe → execute SETUP-COMPLETO.ps1"
} else {
  Check-OK "Pasta privado/ existe"

  # Token GitHub
  $ghFile = Join-Path $PRIV '.github_token'
  if (Test-Path $ghFile) {
    $ghTok = (Get-Content $ghFile -Raw).Trim()
    if ($ghTok.StartsWith('ghp_') -or $ghTok.StartsWith('github_pat_')) {
      Check-OK "GitHub Token presente (${($ghTok.Substring(0,8))}...)"
    } else {
      Check-Warn "GitHub Token presente mas formato inesperado"
    }
  } else { Check-Fail "GitHub Token ausente → privado\.github_token" }

  # Token Telegram
  $tgFile = Join-Path $PRIV '.telegram_token'
  if (Test-Path $tgFile) {
    $tgTok = (Get-Content $tgFile -Raw).Trim()
    if ($tgTok -match '^\d+:') {
      Check-OK "Telegram Token presente ($($tgTok.Split(':')[0]):...)"
    } else {
      Check-Warn "Telegram Token formato inesperado (esperado: 123456:AAA...)"
    }
  } else { Check-Fail "Telegram Token ausente → privado\.telegram_token" }

  # Chat ID
  $chatFile = Join-Path $PRIV '.telegram_chatid'
  if (Test-Path $chatFile) {
    $chatId = (Get-Content $chatFile -Raw).Trim()
    Check-OK "Telegram Chat ID presente: $chatId"
  } else { Check-Fail "Telegram Chat ID ausente → privado\.telegram_chatid" }

  # GitHub config
  $ghConf = Join-Path $PRIV '.github_config'
  if (Test-Path $ghConf) {
    $gc = Get-Content $ghConf | ConvertFrom-StringData
    Check-OK "GitHub Repo configurado: $($gc['REPO'])"
  } else { Check-Warn "GitHub config ausente → execute SETUP-COMPLETO.ps1" }
}

# ═══════════════════════════════════════════════════════════════
Section "CONECTIVIDADE"

# GitHub API
if (Test-Path (Join-Path $PRIV '.github_token')) {
  $tok = (Get-Content (Join-Path $PRIV '.github_token') -Raw).Trim()
  try {
    $resp = Invoke-RestMethod -Uri 'https://api.github.com/user' `
      -Headers @{ Authorization="token $tok"; 'User-Agent'='TrocaPostes' } -ErrorAction Stop
    Check-OK "GitHub API: autenticado como $($resp.login)"
  } catch {
    Check-Fail "GitHub API: falha de autenticação ($($_.Exception.Message.Split([char]10)[0]))"
  }
}

# Telegram API
if (Test-Path (Join-Path $PRIV '.telegram_token')) {
  $tgT = (Get-Content (Join-Path $PRIV '.telegram_token') -Raw).Trim()
  try {
    $resp = Invoke-RestMethod -Uri "https://api.telegram.org/bot$tgT/getMe" -ErrorAction Stop
    if ($resp.ok) { Check-OK "Telegram API: bot @$($resp.result.username) ativo" }
    else { Check-Fail "Telegram API: resposta inválida" }
  } catch {
    Check-Fail "Telegram API: token inválido ou sem conexão"
  }
}

# GitHub Pages (trocas.json)
if (Test-Path (Join-Path $PRIV '.github_config')) {
  $gc2 = Get-Content (Join-Path $PRIV '.github_config') | ConvertFrom-StringData
  $repo = $gc2['REPO']
  if ($repo) {
    $parts = $repo.Split('/')
    $jsonUrl = "https://$($parts[0].ToLower()).github.io/$($parts[1])/site/data/trocas.json"
    try {
      $resp = Invoke-WebRequest -Uri $jsonUrl -TimeoutSec 8 -ErrorAction Stop
      $j = $resp.Content | ConvertFrom-Json
      Check-OK "GitHub Pages: trocas.json OK ($($j.total) registros, gerado $($j.gerado_em))"
    } catch {
      Check-Warn "GitHub Pages: $jsonUrl não acessível (normal se Pages recém ativado)"
    }
  }
}

# Internet geral
try {
  Invoke-WebRequest -Uri 'https://nominatim.openstreetmap.org' -TimeoutSec 5 -ErrorAction Stop | Out-Null
  Check-OK "Internet: Nominatim (geocoding fallback) acessível"
} catch {
  Check-Warn "Internet: Nominatim não acessível"
}

# ═══════════════════════════════════════════════════════════════
Section "REPOSITÓRIO GIT"

Push-Location $ROOT
$gitRemote = git remote get-url origin 2>&1
if ($LASTEXITCODE -eq 0) {
  # Oculta token na URL se presente
  $remoteDisplay = $gitRemote -replace 'https://[^@]+@', 'https://***@'
  Check-OK "Remote origin: $remoteDisplay"
} else {
  Check-Fail "Sem remote 'origin' → execute SETUP-COMPLETO.ps1 ou: git remote add origin ..."
}

$gitBranch = git branch --show-current 2>&1
if ($gitBranch) { Check-OK "Branch atual: $gitBranch" }

$pendentes = git status --short 2>&1
if ($pendentes) {
  Check-Warn "Arquivos não commitados ($($pendentes.Count) itens) → rode PUBLICAR-TROCA-POSTES.bat"
} else {
  Check-OK "Repositório limpo (nada para commitar)"
}
Pop-Location

# ═══════════════════════════════════════════════════════════════
Section "ESTADO DO SETUP (privado/setup_estado.json)"

$estadoFile = Join-Path $PRIV 'setup_estado.json'
if (Test-Path $estadoFile) {
  $est = Get-Content $estadoFile | ConvertFrom-Json
  $est.PSObject.Properties | ForEach-Object {
    if ($_.Value -eq $true) { Check-OK "Setup.$($_.Name)" }
    else { Check-Warn "Setup.$($_.Name) = false" }
  }
} else {
  Check-Warn "setup_estado.json ausente → execute SETUP-COMPLETO.ps1"
}

# ═══════════════════════════════════════════════════════════════
# RESUMO
# ═══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ────────────────────────────────────────────────" -ForegroundColor Gray
$corResumo = if ($script:totalFail -gt 0) { 'Red' } elseif ($script:totalWarn -gt 0) { 'Yellow' } else { 'Green' }
$icone = if ($script:totalFail -gt 0) { '🔴' } elseif ($script:totalWarn -gt 0) { '🟡' } else { '🟢' }
Write-Host "  $icone RESULTADO: $($script:totalOK) OK   $($script:totalWarn) avisos   $($script:totalFail) erros" -ForegroundColor $corResumo
Write-Host ""

if ($script:totalFail -gt 0) {
  Write-Host "  Corrija os erros (❌) antes de usar o sistema." -ForegroundColor Red
  Write-Host "  Execute SETUP-COMPLETO.ps1 para guia interativo." -ForegroundColor Yellow
} elseif ($script:totalWarn -gt 0) {
  Write-Host "  Sistema parcialmente configurado. Revise os avisos (⚠️)." -ForegroundColor Yellow
} else {
  Write-Host "  Tudo configurado! Sistema pronto para uso." -ForegroundColor Green
  Write-Host "  Próximo passo: execute 'Processar tudo' na planilha." -ForegroundColor Cyan
}
Write-Host ""
pause
