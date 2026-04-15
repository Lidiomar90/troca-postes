@echo off
:: Envia código ao Google Apps Script via clasp
chcp 65001 >nul
powershell.exe -ExecutionPolicy Bypass -File "%~dp0PUSH-CLASP.ps1"
