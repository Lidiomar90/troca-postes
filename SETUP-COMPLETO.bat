@echo off
:: Setup completo do projeto TROCA-POSTES
chcp 65001 >nul
powershell.exe -ExecutionPolicy Bypass -File "%~dp0SETUP-COMPLETO.ps1"
