#Requires -Version 5.1
<#
.SYNOPSIS
  SETUP-COMPLETO.ps1 — Setup interativo end-to-end do projeto TROCA-POSTES
.DESCRIPTION
  Verifica pré-requisitos, configura credenciais, faz push do Apps Script,
  cria repositório GitHub Pages e publica o site estático.
  Execute uma única vez após clonar/criar o projeto.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$HOST.UI.RawUI.WindowTitle = 'SETUP TROCA-POSTES'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# ── Cores ─────────────────────────────────────────────────────
function Write-Header  { param($m) Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Write-OK      { param($m) Write-Host "  [OK] $m" -ForegroundColor Green }
function Write-Warn    { param($m) Write-Host "  [AVISO] $m" -ForegroundColor Yellow }
function Write-Fail    { param($m) Write-Host "  [ERRO] $m" -ForegroundColor Red }
function Write-Step    { param($m) Write-Host "`n  >> $m" -ForegroundColor White }
function Read-Prompt   { param($p) Read-Host "  $p" }
function Read-Secret   {
  param($p)
  $s = Read-Host "  $p" -AsSecureString
  [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}

$ROOT  = $PSScriptRoot
$PRIV  = Join-Path $ROOT 'privado'
$APPSDIR = Join-Path $ROOT 'apps-script'
$SITEDIR = Join-Path $ROOT 'site'

# ── Estado de setup ───────────────────────────────────────────
$estado = [ordered]@{
  prereqs         = $false
  privado_criado  = $false
  tokens_salvos   = $false
  clasp_logado    = $false
  clasp_pushed    = $false
  git_configurado = $false
  github_pushed   = $false
  pages_ativo     = $false
}

# ═══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║       TROCA-POSTES — SETUP COMPLETO              ║" -ForegroundColor Cyan
Write-Host "║  Automação de Troca de Postes com Leaflet +      ║" -ForegroundColor Cyan
Write-Host "║  Google Apps Script + Telegram + GitHub Pages    ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Pasta do projeto: $ROOT" -ForegroundColor Gray
Write-Host ""

# ═══════════════════════════════════════════════════════════════
# ETAPA 1 — PRÉ-REQUISITOS
# ═══════════════════════════════════════════════════════════════
Write-Header "ETAPA 1/7 — Verificando pré-requisitos"

$missingPrereqs = @()

# Node.js
try {
  $nodeVer = node --version 2>&1
  Write-OK "Node.js: $nodeVer"
} catch {
  $missingPrereqs += "Node.js"
  Write-Fail "Node.js não encontrado. Instale em https://nodejs.org"
}

# clasp
try {
  $claspVer = clasp --version 2>&1
  Write-OK "clasp: $claspVer"
} catch {
  Write-Warn "clasp não instalado. Instalando..."
  npm install -g @google/clasp
  Write-OK "clasp instalado"
}

# git
try {
  $gitVer = git --version 2>&1
  Write-OK "git: $gitVer"
} catch {
  $missingPrereqs += "git"
  Write-Fail "git não encontrado. Instale em https://git-scm.com"
}

# gh CLI (opcional mas recomendado)
$ghAvail = $false
try {
  $ghVer = gh --version 2>&1 | Select-Object -First 1
  Write-OK "GitHub CLI: $ghVer"
  $ghAvail = $true
} catch {
  Write-Warn "GitHub CLI não instalado (opcional). Instale em https://cli.github.com para criar o repo automaticamente."
}

if ($missingPrereqs.Count -gt 0) {
  Write-Fail "Instale os pré-requisitos antes de continuar: $($missingPrereqs -join ', ')"
  pause; exit 1
}
$estado.prereqs = $true
Write-OK "Todos os pré-requisitos OK"

# ═══════════════════════════════════════════════════════════════
# ETAPA 2 — CREDENCIAIS / TOKENS
# ═══════════════════════════════════════════════════════════════
Write-Header "ETAPA 2/7 — Configurando credenciais"

# Pasta privada
if (-not (Test-Path $PRIV)) {
  New-Item -ItemType Directory -Path $PRIV | Out-Null
}
# Garante que privado/ está no .gitignore
$gi = Join-Path $ROOT '.gitignore'
if ((Get-Content $gi -Raw) -notmatch 'privado/') {
  Add-Content $gi "`nprivado/"
  Write-OK ".gitignore: adicionado privado/"
}
$estado.privado_criado = $true

# ── GitHub Token ──────────────────────────────────────────────
$ghTokenFile = Join-Path $PRIV '.github_token'
if (Test-Path $ghTokenFile) {
  $ghToken = (Get-Content $ghTokenFile -Raw).Trim()
  Write-OK "GitHub token já configurado em privado/.github_token"
} else {
  Write-Host ""
  Write-Host "  Para criar um GitHub Personal Access Token:" -ForegroundColor Gray
  Write-Host "  github.com → Settings → Developer settings → Personal access tokens" -ForegroundColor Gray
  Write-Host "  Permissões necessárias: Contents (Read+Write), Pages (Write)" -ForegroundColor Gray
  Write-Host ""
  $ghToken = Read-Secret "Cole seu GitHub Token (ghp_...) [Enter para pular]"
  if ($ghToken -ne '') {
    Set-Content -Path $ghTokenFile -Value $ghToken -NoNewline
    Write-OK "Token GitHub salvo em privado/.github_token"
  } else {
    Write-Warn "Token GitHub não configurado. Push automático do JSON não funcionará."
  }
}

# ── Telegram Token ────────────────────────────────────────────
$tgTokenFile = Join-Path $PRIV '.telegram_token'
if (Test-Path $tgTokenFile) {
  $tgToken = (Get-Content $tgTokenFile -Raw).Trim()
  Write-OK "Telegram token já configurado"
} else {
  Write-Host ""
  Write-Host "  Obtenha o token via @BotFather no Telegram: /newbot" -ForegroundColor Gray
  Write-Host ""
  $tgToken = Read-Secret "Cole seu Telegram Bot Token [Enter para pular]"
  if ($tgToken -ne '') {
    Set-Content -Path $tgTokenFile -Value $tgToken -NoNewline
    Write-OK "Token Telegram salvo em privado/.telegram_token"
  } else {
    Write-Warn "Token Telegram não configurado. Alertas não funcionarão."
  }
}

# ── Telegram Chat ID ──────────────────────────────────────────
$tgChatFile = Join-Path $PRIV '.telegram_chatid'
if (Test-Path $tgChatFile) {
  $tgChatId = (Get-Content $tgChatFile -Raw).Trim()
  Write-OK "Telegram Chat ID já configurado: $tgChatId"
} else {
  Write-Host ""
  Write-Host "  Para descobrir o Chat ID do grupo: adicione @userinfobot ao grupo" -ForegroundColor Gray
  Write-Host "  ou envie /start ao bot e veja o id em https://api.telegram.org/bot{TOKEN}/getUpdates" -ForegroundColor Gray
  Write-Host ""
  $tgChatId = Read-Prompt "Cole o Telegram Chat ID (ex: -1001234567890) [Enter para pular]"
  if ($tgChatId -ne '') {
    Set-Content -Path $tgChatFile -Value $tgChatId -NoNewline
    Write-OK "Chat ID salvo em privado/.telegram_chatid"
  }
}

# ── Configurações do repo GitHub ──────────────────────────────
$ghConfigFile = Join-Path $PRIV '.github_config'
if (Test-Path $ghConfigFile) {
  $ghConfig = Get-Content $ghConfigFile | ConvertFrom-StringData
  $ghRepo   = $ghConfig['REPO']
  $ghBranch = $ghConfig['BRANCH']
  Write-OK "Config GitHub: $ghRepo ($ghBranch)"
} else {
  $ghRepo   = Read-Prompt "Nome do repositório GitHub (ex: Lidiomar90/troca-postes)"
  if ($ghRepo -eq '') { $ghRepo = 'Lidiomar90/troca-postes' }
  $ghBranch = 'main'
  "REPO=$ghRepo`nBRANCH=$ghBranch" | Set-Content $ghConfigFile
  Write-OK "Configuração GitHub salva: $ghRepo"
}

$estado.tokens_salvos = $true

# ── Testa Telegram imediatamente (se configurado) ─────────────
if ($tgToken -ne '' -and $tgChatId -ne '') {
  Write-Step "Testando conexão Telegram..."
  $testMsg = [PSCustomObject]@{
    chat_id    = $tgChatId
    text       = "✅ *TROCA-POSTES*`nSetup iniciado em $([datetime]::Now.ToString('dd/MM/yyyy HH:mm'))"
    parse_mode = 'Markdown'
  } | ConvertTo-Json
  try {
    $tgResp = Invoke-RestMethod `
      -Uri "https://api.telegram.org/bot$tgToken/sendMessage" `
      -Method Post -ContentType 'application/json' -Body $testMsg `
      -ErrorAction SilentlyContinue
    if ($tgResp.ok) { Write-OK "Telegram OK — mensagem de teste enviada!" }
    else { Write-Warn "Telegram respondeu mas com erro: $($tgResp.description)" }
  } catch {
    Write-Warn "Falha no teste Telegram: $_"
  }
}

# ── Testa GitHub Token (se configurado) ───────────────────────
if ($ghToken -ne '') {
  Write-Step "Testando GitHub Token..."
  try {
    $ghUser = Invoke-RestMethod `
      -Uri 'https://api.github.com/user' `
      -Headers @{ Authorization = "token $ghToken"; 'User-Agent' = 'TrocaPostes' } `
      -ErrorAction Stop
    Write-OK "GitHub OK — autenticado como: $($ghUser.login)"
  } catch {
    Write-Warn "Token GitHub inválido ou sem permissão: $_"
  }
}

# ═══════════════════════════════════════════════════════════════
# ETAPA 3 — APPS SCRIPT / CLASP
# ═══════════════════════════════════════════════════════════════
Write-Header "ETAPA 3/7 — Configurando Google Apps Script (clasp)"

# Verifica se já está logado no clasp
$claspConfigPath = Join-Path $env:APPDATA 'clasp' 'oauth2.json'
$claspLogado = Test-Path $claspConfigPath

if (-not $claspLogado) {
  Write-Step "Login no Google (abrirá o navegador)..."
  Write-Host "  Faça login com a conta Google que tem acesso à planilha." -ForegroundColor Gray
  Set-Location $APPSDIR
  clasp login
  $claspLogado = $true
} else {
  Write-OK "clasp já autenticado"
}
$estado.clasp_logado = $true

# Verifica e configura .clasp.json
$claspJson = Join-Path $APPSDIR '.clasp.json'
$claspConfig = Get-Content $claspJson | ConvertFrom-Json

if ($claspConfig.scriptId -eq 'COLE_AQUI_O_SCRIPT_ID') {
  Write-Host ""
  Write-Host "  Para obter o Script ID:" -ForegroundColor Gray
  Write-Host "  1. Abra a planilha: https://docs.google.com/spreadsheets/d/1z06pVVJlCkwfojWyHnuBjyDQbGv8TE-yFAHlUePqjVU" -ForegroundColor Gray
  Write-Host "  2. Menu Extensões > Apps Script" -ForegroundColor Gray
  Write-Host "  3. Ícone ⚙️ (Configurações) > Script ID" -ForegroundColor Gray
  Write-Host ""
  $scriptId = Read-Prompt "Cole o Script ID do Apps Script [Enter para criar novo script standalone]"

  if ($scriptId -ne '') {
    $claspConfig.scriptId = $scriptId
    $claspConfig | ConvertTo-Json | Set-Content $claspJson
    Write-OK "Script ID configurado: $scriptId"
  } else {
    Write-Step "Criando script standalone novo..."
    Set-Location $APPSDIR
    clasp create --type standalone --title 'TROCA-POSTES'
    Write-OK "Script criado — verifique o .clasp.json para o scriptId"
  }
}

# Push do código
Write-Step "Enviando código para o Google Apps Script..."
Set-Location $APPSDIR
$pushResult = clasp push --force 2>&1
if ($LASTEXITCODE -eq 0) {
  Write-OK "clasp push concluído com sucesso"
  $estado.clasp_pushed = $true
} else {
  Write-Fail "Erro no clasp push:`n$pushResult"
  Write-Warn "Verifique o erro acima. Você pode rodar PUSH-CLASP.bat manualmente."
}

# ── Instrui sobre Script Properties ──────────────────────────
Write-Host ""
Write-Host "  AÇÃO MANUAL NECESSÁRIA — Script Properties:" -ForegroundColor Yellow
Write-Host "  ─────────────────────────────────────────────" -ForegroundColor Gray
Write-Host "  Acesse: https://script.google.com" -ForegroundColor Gray
Write-Host "  Abra o projeto > ⚙️ Configurações > Propriedades do projeto" -ForegroundColor Gray
Write-Host ""
Write-Host "  Configure estas chaves:" -ForegroundColor White
Write-Host "    TELEGRAM_TOKEN    = $($tgToken.Substring(0, [Math]::Min(10, $tgToken.Length)))..." -ForegroundColor Gray
Write-Host "    TELEGRAM_CHAT_ID  = $tgChatId" -ForegroundColor Gray
Write-Host "    GITHUB_TOKEN      = $($ghToken.Substring(0, [Math]::Min(10, $ghToken.Length)))..." -ForegroundColor Gray
Write-Host "    GITHUB_REPO       = $ghRepo" -ForegroundColor Gray
Write-Host "    GITHUB_BRANCH     = main" -ForegroundColor Gray
Write-Host ""

# Gera script de configuração copiável
$scriptPropsHelper = @"
// Cole este código no console do Apps Script (Ctrl+Shift+I) e execute:
function configurarPropriedades() {
  const props = PropertiesService.getScriptProperties();
  props.setProperties({
    'TELEGRAM_TOKEN':  '$tgToken',
    'TELEGRAM_CHAT_ID': '$tgChatId',
    'GITHUB_TOKEN':    '$ghToken',
    'GITHUB_REPO':     '$ghRepo',
    'GITHUB_BRANCH':   'main',
  });
  Logger.log('Propriedades configuradas!');
}
"@
$propsFile = Join-Path $PRIV 'configurar_props.gs.txt'
Set-Content -Path $propsFile -Value $scriptPropsHelper -Encoding UTF8
Write-OK "Script auxiliar de propriedades salvo em privado/configurar_props.gs.txt"
Write-Host "  (contém seus tokens — NÃO commitar esta pasta)" -ForegroundColor Yellow

# ═══════════════════════════════════════════════════════════════
# ETAPA 4 — INICIALIZAR PLANILHA (instrução)
# ═══════════════════════════════════════════════════════════════
Write-Header "ETAPA 4/7 — Inicializar planilha Google Sheets"

Write-Host ""
Write-Host "  AÇÃO MANUAL — Execute no Apps Script:" -ForegroundColor Yellow
Write-Host "  1. Acesse https://script.google.com e abra o projeto" -ForegroundColor Gray
Write-Host "  2. Selecione a função: inicializarPlanilha" -ForegroundColor Gray
Write-Host "  3. Clique em ▶ Executar" -ForegroundColor Gray
Write-Host "  4. Isso criará as abas: TROCAS, CONFIG, BASE_REDE, LOG_EXECUCAO, etc." -ForegroundColor Gray
Write-Host ""

$resp = Read-Prompt "Já executou inicializarPlanilha()? (s/n)"
if ($resp -match '^s') {
  Write-OK "Planilha inicializada"
} else {
  Write-Warn "Execute inicializarPlanilha() antes de continuar. Depois rode este script novamente."
}

# ═══════════════════════════════════════════════════════════════
# ETAPA 5 — REPOSITÓRIO GITHUB
# ═══════════════════════════════════════════════════════════════
Write-Header "ETAPA 5/7 — Repositório GitHub Pages"
Set-Location $ROOT

# Inicializa git se necessário
if (-not (Test-Path (Join-Path $ROOT '.git'))) {
  git init
  git branch -M main
  Write-OK "Repositório git inicializado"
} else {
  Write-OK "Repositório git já existe"
}

# Cria .gitignore correto para privado/
$giContent = Get-Content (Join-Path $ROOT '.gitignore') -Raw
if ($giContent -notmatch 'privado/') {
  Add-Content (Join-Path $ROOT '.gitignore') "`nprivado/"
}

# Configura remote
$remoteExists = git remote get-url origin 2>&1
if ($LASTEXITCODE -ne 0) {
  if ($ghToken -ne '' -and $ghAvail) {
    Write-Step "Criando repositório $ghRepo no GitHub..."
    $repoName = ($ghRepo -split '/')[-1]
    try {
      gh repo create $ghRepo --public --description 'Mapa operacional de troca de postes' 2>&1
      Write-OK "Repositório criado: https://github.com/$ghRepo"
    } catch {
      Write-Warn "Não foi possível criar via gh CLI: $_"
    }
  }

  $remoteUrl = if ($ghToken -ne '') {
    "https://$ghToken@github.com/$ghRepo.git"
  } else {
    "https://github.com/$ghRepo.git"
  }
  git remote add origin $remoteUrl
  Write-OK "Remote configurado: $ghRepo"
}
$estado.git_configurado = $true

# Commit e push inicial
Write-Step "Preparando commit inicial..."
git add -A
git status --short

$commitMsg = "feat: init troca-postes $(Get-Date -Format 'yyyy-MM-dd')"
git commit -m $commitMsg 2>&1 | Out-Null

Write-Step "Publicando no GitHub..."
if ($ghToken -ne '') {
  $remoteWithToken = "https://$ghToken@github.com/$ghRepo.git"
  git config http.version HTTP/1.1
  git config http.postBuffer 52428800
  $pushOut = git push $remoteWithToken main --force 2>&1
} else {
  $pushOut = git push origin main 2>&1
}

if ($LASTEXITCODE -eq 0) {
  Write-OK "Push inicial concluído!"
  $estado.github_pushed = $true
} else {
  Write-Warn "Erro no push: $pushOut"
  Write-Warn "Tente manualmente: git push origin main"
}

# ═══════════════════════════════════════════════════════════════
# ETAPA 6 — ATIVAR GITHUB PAGES
# ═══════════════════════════════════════════════════════════════
Write-Header "ETAPA 6/7 — Ativando GitHub Pages"

if ($ghToken -ne '') {
  Write-Step "Configurando GitHub Pages via API..."
  try {
    $pagesBody = '{"source":{"branch":"main","path":"/"}}'
    $pagesResp = Invoke-RestMethod `
      -Uri "https://api.github.com/repos/$ghRepo/pages" `
      -Method Post `
      -Headers @{
        Authorization = "token $ghToken"
        'User-Agent' = 'TrocaPostes'
        Accept = 'application/vnd.github.v3+json'
      } `
      -ContentType 'application/json' `
      -Body $pagesBody `
      -ErrorAction SilentlyContinue

    Write-OK "GitHub Pages ativado!"
    $siteUrl = "https://$($ghRepo.Split('/')[0]).github.io/$($ghRepo.Split('/')[1])/site/"
    Write-OK "URL do site (disponível em ~2min): $siteUrl"
    $estado.pages_ativo = $true
  } catch {
    Write-Warn "Pages já ativo ou erro: $_"
    Write-Warn "Ative manualmente: github.com/$ghRepo > Settings > Pages > Source: main"
  }
} else {
  Write-Warn "Token GitHub não disponível. Ative Pages manualmente:"
  Write-Host "  github.com/$ghRepo > Settings > Pages > Source: main > pasta: / (root)" -ForegroundColor Gray
}

# ═══════════════════════════════════════════════════════════════
# ETAPA 7 — CONFIGURAR TRIGGERS
# ═══════════════════════════════════════════════════════════════
Write-Header "ETAPA 7/7 — Triggers automáticos do Apps Script"

Write-Host ""
Write-Host "  AÇÃO MANUAL — Configure os triggers:" -ForegroundColor Yellow
Write-Host "  1. No Apps Script, execute: configurarTriggers()" -ForegroundColor Gray
Write-Host "     OU vá em ⏰ Triggers > Adicionar trigger" -ForegroundColor Gray
Write-Host ""
Write-Host "  Triggers a criar:" -ForegroundColor White
Write-Host "    • processarTudo()          — todo dia às 07:00 (pipeline D0)" -ForegroundColor Gray
Write-Host "    • verificarEEnviarAlertas() — todo dia às 23:00 (D-1 véspera)" -ForegroundColor Gray
Write-Host ""

# ═══════════════════════════════════════════════════════════════
# RESUMO FINAL
# ═══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║             RESUMO DO SETUP                      ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan

$status = @{
  $true  = "[OK]  "
  $false = "[----] "
}
Write-Host ""
Write-Host "  $($status[$estado.prereqs])Pré-requisitos"         -ForegroundColor $(if ($estado.prereqs) { 'Green' } else { 'Red' })
Write-Host "  $($status[$estado.tokens_salvos])Tokens/credenciais"      -ForegroundColor $(if ($estado.tokens_salvos) { 'Green' } else { 'Yellow' })
Write-Host "  $($status[$estado.clasp_logado])clasp autenticado"         -ForegroundColor $(if ($estado.clasp_logado) { 'Green' } else { 'Yellow' })
Write-Host "  $($status[$estado.clasp_pushed])Código no Apps Script"     -ForegroundColor $(if ($estado.clasp_pushed) { 'Green' } else { 'Red' })
Write-Host "  $($status[$estado.git_configurado])Repositório git"         -ForegroundColor $(if ($estado.git_configurado) { 'Green' } else { 'Yellow' })
Write-Host "  $($status[$estado.github_pushed])Push GitHub concluído"     -ForegroundColor $(if ($estado.github_pushed) { 'Green' } else { 'Yellow' })
Write-Host "  $($status[$estado.pages_ativo])GitHub Pages ativo"         -ForegroundColor $(if ($estado.pages_ativo) { 'Green' } else { 'Yellow' })
Write-Host ""

$siteUrl2 = "https://$($ghRepo.Split('/')[0]).github.io/$($ghRepo.Split('/')[1])/site/"
Write-Host "  PENDÊNCIAS MANUAIS (no Google Apps Script):" -ForegroundColor Yellow
Write-Host "    1. Configure Script Properties (use privado/configurar_props.gs.txt)" -ForegroundColor Gray
Write-Host "    2. Execute inicializarPlanilha()" -ForegroundColor Gray
Write-Host "    3. Execute configurarTriggers()" -ForegroundColor Gray
Write-Host "    4. Importe dados em BASE_REDE ou execute importarBaseRedeSupabase()" -ForegroundColor Gray
Write-Host ""
Write-Host "  Site (disponível após ~2min): $siteUrl2" -ForegroundColor Cyan
Write-Host "  Guia completo: CONFIGURAR.md" -ForegroundColor Gray
Write-Host ""

# Salva estado do setup para VALIDAR-CONFIGURACAO.ps1 usar depois
$estado | ConvertTo-Json | Set-Content (Join-Path $PRIV 'setup_estado.json') -Encoding UTF8
Write-Host "  Estado salvo em privado/setup_estado.json" -ForegroundColor Gray
Write-Host ""
pause
