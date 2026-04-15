@echo off
:: Valida configuração do projeto TROCA-POSTES
chcp 65001 >nul
powershell.exe -ExecutionPolicy Bypass -File "%~dp0VALIDAR-CONFIGURACAO.ps1"
