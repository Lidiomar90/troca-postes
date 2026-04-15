@'
# TROCA-POSTES

Projeto de automação operacional com Google Apps Script, site estático, integração com Telegram, geocodificação, sincronização com planilhas e suporte a persistência externa.

## Estrutura

- `apps-script/` → código oficial do Google Apps Script
- `site/` → interface web e arquivos de dados
- `supabase/` → scripts SQL e suporte backend
- `scripts/` → automações PowerShell e BAT
- `docs/` → documentação do projeto
- `privado/` → arquivos locais não versionados

## Fluxo principal

### Apps Script
```powershell
cd .\apps-script
clasp status
clasp push