#Requires -Version 5.1
<#
.SYNOPSIS
  MONITORAR.ps1 — Health-check diário do sistema TROCA-POSTES
  Verifica se pipeline rodou, alertas foram enviados, site está atualizado.
  Pode ser agendado no Agendador de Tarefas do Windows.
.NOTES
  Para agendar via Agendador de Tarefas, use AGENDAR-MONITOR.bat.
  Logs salvos em privado/monitor_log.txt.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ROOT     = $PSScriptRoot
$PRIV     = Join-Path $ROOT 'privado'
$LOG_FILE = Join-Path $PRIV 'monitor_log.txt'
$AGORA    = Get-Date
$HOJE     = $AGORA.ToString('dd/MM/yyyy')
$ISO      = $AGORA.ToString('yyyy-MM-dd HH:mm:ss')

# ── Logging ───────────────────────────────────────────────────
function Log-Line { param($nivel, $msg)
  $linha = "[$ISO] [$nivel] $msg"
  Add-Content -Path $LOG_FILE -Value $linha -Encoding UTF8
  $cor = switch ($nivel) {
    'OK'   { 'Green' }
    'WARN' { 'Yellow' }
    'FAIL' { 'Red' }
    'INFO' { 'Cyan' }
    default { 'Gray' }
  }
  Write-Host $linha -ForegroundColor $cor
}

# Limita log a 500 linhas
if (Test-Path $LOG_FILE) {
  $linhas = Get-Content $LOG_FILE
  if ($linhas.Count -gt 500) {
    $linhas[-400..-1] | Set-Content $LOG_FILE -Encoding UTF8
  }
}

# ── Carrega configurações ─────────────────────────────────────
$tgToken  = if (Test-Path "$PRIV\.telegram_token") { (Get-Content "$PRIV\.telegram_token" -Raw).Trim() } else { '' }
$tgChatId = if (Test-Path "$PRIV\.telegram_chatid") { (Get-Content "$PRIV\.telegram_chatid" -Raw).Trim() } else { '' }
$ghToken  = if (Test-Path "$PRIV\.github_token") { (Get-Content "$PRIV\.github_token" -Raw).Trim() } else { '' }
$ghRepo   = if (Test-Path "$PRIV\.github_config") { ((Get-Content "$PRIV\.github_config" | ConvertFrom-StringData)['REPO']) } else { '' }

$alertas = @()  # coleta alertas para envio único ao Telegram

# ═══════════════════════════════════════════════════════════════
Log-Line INFO "=== MONITOR TROCA-POSTES iniciado ($HOJE) ==="

# ── 1. trocas.json no GitHub Pages ───────────────────────────
if ($ghRepo) {
  $parts   = $ghRepo.Split('/')
  $jsonUrl = "https://$($parts[0].ToLower()).github.io/$($parts[1])/site/data/trocas.json"
  try {
    $resp = Invoke-WebRequest -Uri $jsonUrl -TimeoutSec 10 -ErrorAction Stop
    $j    = $resp.Content | ConvertFrom-Json
    $geradoEm = [datetime]::Parse($j.gerado_em).ToLocalTime()
    $idadeHoras = ($AGORA - $geradoEm).TotalHours

    if ($idadeHoras -gt 25) {
      Log-Line WARN "trocas.json desatualizado: gerado há $([Math]::Round($idadeHoras,1))h (>25h)"
      $alertas += "⚠️ trocas.json desatualizado há $([Math]::Round($idadeHoras,1))h — pipeline do Apps Script pode ter falhado"
    } else {
      Log-Line OK "trocas.json OK: $($j.total) registros, gerado há $([Math]::Round($idadeHoras,1))h"
    }

    # Verifica trocas hoje sem alerta D0
    $trocasHoje = $j.trocas | Where-Object { $_.dias_ate -eq 0 -and $_.status -ne 'CANCELADO' }
    if ($trocasHoje.Count -gt 0) {
      Log-Line WARN "$($trocasHoje.Count) troca(s) para HOJE encontradas no JSON"
      $alertas += "📋 $($trocasHoje.Count) troca(s) agendada(s) para HOJE: " +
        ($trocasHoje | ForEach-Object { "#$($_.id) $($_.logradouro), $($_.cidade)" } | Join-String -Separator ' | ')
    }

    # Verifica trocas amanhã sem alerta D-1
    $trocasAmanha = $j.trocas | Where-Object { $_.dias_ate -eq 1 -and $_.status -ne 'CANCELADO' }
    if ($trocasAmanha.Count -gt 0) {
      Log-Line INFO "$($trocasAmanha.Count) troca(s) para amanhã"
    }

    # Verifica registros atrasados
    $atrasados = $j.trocas | Where-Object { $_.dias_ate -ne $null -and $_.dias_ate -lt 0 -and $_.status -notin @('EXECUTADO','CANCELADO') }
    if ($atrasados.Count -gt 0) {
      Log-Line WARN "$($atrasados.Count) troca(s) ATRASADA(S) não executadas"
      $alertas += "🔴 $($atrasados.Count) troca(s) com data vencida ainda como PENDENTE/AGENDADO!"
    }

  } catch {
    Log-Line FAIL "Não foi possível acessar trocas.json: $_"
    $alertas += "❌ Monitor: trocas.json inacessível em $jsonUrl"
  }
} else {
  Log-Line WARN "GitHub repo não configurado em privado/.github_config"
}

# ── 2. Telegram Bot acessível ─────────────────────────────────
if ($tgToken) {
  try {
    $resp = Invoke-RestMethod -Uri "https://api.telegram.org/bot$tgToken/getMe" -TimeoutSec 8 -ErrorAction Stop
    if ($resp.ok) {
      Log-Line OK "Telegram bot @$($resp.result.username) ativo"
    } else {
      Log-Line FAIL "Telegram bot retornou ok=false"
      $alertas += "❌ Telegram: bot não respondeu corretamente"
    }
  } catch {
    Log-Line FAIL "Telegram inacessível: $_"
  }
} else {
  Log-Line WARN "Telegram token não configurado"
}

# ── 3. GitHub API acessível ───────────────────────────────────
if ($ghToken) {
  try {
    $resp = Invoke-RestMethod -Uri 'https://api.github.com/user' `
      -Headers @{ Authorization="token $ghToken"; 'User-Agent'='TrocaPostes' } `
      -TimeoutSec 8 -ErrorAction Stop
    Log-Line OK "GitHub API: autenticado como $($resp.login)"
  } catch {
    Log-Line FAIL "GitHub API: falha ($($_.Exception.Message.Split([char]10)[0]))"
    $alertas += "❌ GitHub API indisponível — export JSON pode falhar"
  }
}

# ── 4. Verifica log_monitor_anterior.json ────────────────────
$monitorEstadoFile = Join-Path $PRIV 'monitor_estado.json'
$estadoAnterior = if (Test-Path $monitorEstadoFile) {
  Get-Content $monitorEstadoFile | ConvertFrom-Json
} else { $null }

# Salva estado atual
@{
  ultima_execucao = $ISO
  tg_ok           = ($tgToken -ne '')
  gh_ok           = ($ghToken -ne '')
  alertas_count   = $alertas.Count
} | ConvertTo-Json | Set-Content $monitorEstadoFile -Encoding UTF8

# ── 5. Envia resumo diário ao Telegram (se alertas ou 1x/dia) ──
if ($tgToken -and $tgChatId) {
  $deveEnviarResumo = $false
  $horaAtual = $AGORA.Hour

  # Envia resumo às 06:30 (antes do pipeline das 07:00)
  if ($horaAtual -eq 6) { $deveEnviarResumo = $true }

  # Sempre envia se houver alertas críticos
  if ($alertas.Count -gt 0) { $deveEnviarResumo = $true }

  if ($deveEnviarResumo) {
    $resumoMsg = "🔍 *Monitor TROCA-POSTES* — $HOJE`n`n"

    if ($alertas.Count -eq 0) {
      $resumoMsg += "✅ Tudo funcionando normalmente"
    } else {
      $resumoMsg += $alertas -join "`n`n"
    }
    $resumoMsg += "`n`n_Verificado em $($AGORA.ToString('HH:mm'))_"

    $body = @{
      chat_id    = $tgChatId
      text       = $resumoMsg
      parse_mode = 'Markdown'
    } | ConvertTo-Json

    try {
      $tgResp = Invoke-RestMethod -Uri "https://api.telegram.org/bot$tgToken/sendMessage" `
        -Method Post -ContentType 'application/json' -Body $body -ErrorAction Stop
      if ($tgResp.ok) {
        Log-Line OK "Resumo diário enviado ao Telegram ($($alertas.Count) alertas)"
      }
    } catch {
      Log-Line WARN "Falha ao enviar resumo Telegram: $_"
    }
  }
}

# ── 6. Relatório no console ───────────────────────────────────
Write-Host ""
Write-Host "  ── RESUMO DO MONITOR ──" -ForegroundColor Cyan
if ($alertas.Count -eq 0) {
  Write-Host "  ✅ Nenhum problema detectado." -ForegroundColor Green
} else {
  Write-Host "  ⚠️  $($alertas.Count) alerta(s) detectado(s):" -ForegroundColor Yellow
  $alertas | ForEach-Object { Write-Host "     $_" -ForegroundColor Yellow }
}
Write-Host "  📄 Log: $LOG_FILE" -ForegroundColor Gray
Write-Host ""

Log-Line INFO "=== Monitor concluído. Alertas: $($alertas.Count) ==="
