@echo off
:: ============================================================
:: AGENDAR-MONITOR.bat
:: Registra MONITORAR.ps1 no Agendador de Tarefas do Windows
:: Executa diariamente às 06:30 e 14:00
:: Execute como ADMINISTRADOR
:: ============================================================
setlocal enabledelayedexpansion
chcp 65001 >nul

echo.
echo  Agendando MONITORAR.ps1 no Agendador de Tarefas...
echo.

set SCRIPT_PATH=%~dp0MONITORAR.ps1
set TASK_NAME_AM=TrocaPostes-Monitor-Manha
set TASK_NAME_PM=TrocaPostes-Monitor-Tarde

:: Remove tarefas antigas se existirem
schtasks /delete /tn "%TASK_NAME_AM%" /f >nul 2>&1
schtasks /delete /tn "%TASK_NAME_PM%" /f >nul 2>&1

:: Agenda 06:30 (antes do pipeline das 07:00)
schtasks /create /tn "%TASK_NAME_AM%" ^
  /tr "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%SCRIPT_PATH%\"" ^
  /sc daily /st 06:30 ^
  /ru "%USERNAME%" ^
  /f

if %errorlevel% == 0 (
  echo  [OK] Tarefa agendada: %TASK_NAME_AM% (06:30 diariamente)
) else (
  echo  [ERRO] Falha ao agendar %TASK_NAME_AM% - Execute como Administrador
)

:: Agenda 14:00 (monitoramento da tarde)
schtasks /create /tn "%TASK_NAME_PM%" ^
  /tr "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%SCRIPT_PATH%\"" ^
  /sc daily /st 14:00 ^
  /ru "%USERNAME%" ^
  /f

if %errorlevel% == 0 (
  echo  [OK] Tarefa agendada: %TASK_NAME_PM% (14:00 diariamente)
) else (
  echo  [ERRO] Falha ao agendar %TASK_NAME_PM%
)

echo.
echo  Para verificar: Agendador de Tarefas > Biblioteca > TrocaPostes-*
echo  Para remover:   schtasks /delete /tn "TrocaPostes-Monitor-Manha" /f
echo.
pause
