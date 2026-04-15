@echo off
:: Publicar site no GitHub Pages
chcp 65001 >nul
powershell.exe -ExecutionPolicy Bypass -File "%~dp0PUBLICAR-TROCA-POSTES.ps1"
