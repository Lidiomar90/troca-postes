#Requires -Version 5.1
<#
.SYNOPSIS
  Envia código ao Google Apps Script via clasp com validação completa.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$HOST.UI.RawUI.WindowTitle = 'PUSH CLASP — TROCA-POSTES'

$ROOT    = $PSScriptRoot
$APPSDIR = Join-Path $ROOT 'apps-script'

function Write-OK   { param($m) Write-Host "  [OK] $m" -ForegroundColor Green }
function Write-Warn { param($m) Write-Host "  [AVISO] $m" -ForegroundColor Yellow }
function Write-Fail { param($m) Write-Host "  [ERRO] $m" -ForegroundColor Red }
function Write-Step { param($m) Write-Host "`n  >> $m" -ForegroundColor White }

Write-Host ""
Write-Host "  =============================================" -ForegroundColor Cyan
Write-Host "  PUSH CLASP — Google Apps Script" -ForegroundColor Cyan
Write-Host "  =============================================" -ForegroundColor Cyan

# ── Verifica clasp ────────────────────────────────────────────
$claspVer = clasp --version 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Fail "clasp não instalado."
  Write-Host "  Execute: npm install -g @google/clasp" -ForegroundColor Yellow
  Read-Host "  Enter para sair"; exit 1
}
Write-OK "clasp: $claspVer"

# ── Verifica autenticação ─────────────────────────────────────
$claspAuth = Join-Path $env:APPDATA 'clasp\oauth2.json'
if (-not (Test-Path $claspAuth)) {
  Write-Warn "clasp não autenticado. Iniciando login..."
  Set-Location $APPSDIR
  clasp login
  if ($LASTEXITCODE -ne 0) {
    Write-Fail "Login falhou."
    Read-Host "  Enter para sair"; exit 1
  }
}
Write-OK "clasp autenticado"

# ── Verifica scriptId ──────────────────────────────────────────
$claspJson = Join-Path $APPSDIR '.clasp.json'
$cj = Get-Content $claspJson | ConvertFrom-Json
if ($cj.scriptId -eq 'COLE_AQUI_O_SCRIPT_ID') {
  Write-Fail "scriptId não configurado em apps-script\.clasp.json"
  Write-Host ""
  Write-Host "  Como obter o Script ID:" -ForegroundColor Yellow
  Write-Host "  1. Abra a planilha Google Sheets" -ForegroundColor Gray
  Write-Host "  2. Extensões > Apps Script" -ForegroundColor Gray
  Write-Host "  3. Ícone ⚙️ (Configurações) > Script ID" -ForegroundColor Gray
  Write-Host "  4. Cole no arquivo apps-script\.clasp.json" -ForegroundColor Gray
  Read-Host "  Enter para sair"; exit 1
}
Write-OK "Script ID: $($cj.scriptId.Substring(0,[Math]::Min(16,$cj.scriptId.Length)))..."

# ── Verifica arquivos .gs ──────────────────────────────────────
$gsFiles = Get-ChildItem $APPSDIR -Filter '*.gs' | Measure-Object
Write-OK "$($gsFiles.Count) arquivos .gs encontrados"

# ── Push ──────────────────────────────────────────────────────
Write-Step "Enviando para o Google Apps Script..."
Set-Location $APPSDIR
$pushOut = clasp push --force 2>&1

if ($LASTEXITCODE -eq 0) {
  Write-OK "Push concluído com sucesso!"
  Write-Host ""
  Write-Host "  Próximos passos no Apps Script:" -ForegroundColor Cyan
  Write-Host "    1. Execute inicializarPlanilha() (se ainda não fez)" -ForegroundColor Gray
  Write-Host "    2. Configure Script Properties (tokens)" -ForegroundColor Gray
  Write-Host "    3. Execute configurarTriggers()" -ForegroundColor Gray
  Write-Host "    4. Execute diagnosticoCompleto() para validar" -ForegroundColor Gray
  Write-Host ""
  Write-Host "  Abrir Apps Script: https://script.google.com" -ForegroundColor Cyan
} else {
  Write-Fail "Erro no push:"
  Write-Host $pushOut -ForegroundColor Red
  Write-Host ""
  Write-Host "  Verifique:" -ForegroundColor Yellow
  Write-Host "    - Você está logado? Execute: clasp login" -ForegroundColor Gray
  Write-Host "    - O scriptId está correto?" -ForegroundColor Gray
  Write-Host "    - A API do Apps Script está ativa? https://script.google.com/home/usersettings" -ForegroundColor Gray
}
Write-Host ""
Read-Host "  Enter para fechar"
