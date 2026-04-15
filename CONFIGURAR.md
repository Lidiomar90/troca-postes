# Guia de Configuração — TROCA-POSTES

## 1. Pré-requisitos

- Node.js instalado (para usar o clasp)
- Google account com acesso à planilha
- Bot Telegram criado via @BotFather
- Conta GitHub com repositório criado

## 2. Instalar clasp (Google Apps Script CLI)

```bash
npm install -g @google/clasp
clasp login
```

## 3. Criar o projeto no Google Apps Script

### Opção A — script vinculado à planilha (recomendado):
1. Abra a planilha: https://docs.google.com/spreadsheets/d/1z06pVVJlCkwfojWyHnuBjyDQbGv8TE-yFAHlUePqjVU
2. Menu → Extensões → Apps Script
3. No Apps Script: clique em ⚙️ (Configurações do projeto)
4. Copie o **Script ID**
5. Cole no arquivo `apps-script/.clasp.json` no campo `"scriptId"`

### Opção B — script standalone:
```bash
cd apps-script
clasp create --type standalone --title "TROCA-POSTES"
```
Isso atualiza o `.clasp.json` automaticamente.

## 4. Publicar o código no Google Apps Script

```bash
cd apps-script
clasp push
```

## 5. Configurar Script Properties (credenciais sensíveis)

No Apps Script Editor: ⚙️ → Propriedades do projeto → Adicionar propriedade:

| Chave               | Valor                        | Obrigatório |
|---------------------|------------------------------|-------------|
| TELEGRAM_TOKEN      | Token do bot (ex: 123:AAA...)| SIM         |
| TELEGRAM_CHAT_ID    | ID do chat/grupo (-100xxx)   | SIM         |
| GITHUB_TOKEN        | ghp_xxxxxxxx (Personal Access Token) | SIM |
| GITHUB_REPO         | Lidiomar90/troca-postes      | SIM         |
| GITHUB_BRANCH       | main                         | SIM         |
| SPREADSHEET_ID      | ID da planilha (se não vincular) | Opcional |
| SUPABASE_URL        | https://xxx.supabase.co      | Opcional    |
| SUPABASE_ANON_KEY   | eyJ...                       | Opcional    |

**NUNCA** coloque o token Telegram ou GitHub Token diretamente no código!
Use sempre Script Properties.

## 6. Inicializar a planilha

No Apps Script Editor ou via menu na planilha:
1. Execute a função `inicializarPlanilha()`
2. Ela cria as abas: TROCAS, CONFIG, BASE_REDE, LOG_EXECUCAO, LOG_ALERTAS, FILA_REVISAO_MANUAL

## 7. Importar dados de rede (BASE_REDE)

### Opção A — Via Supabase (se SUPABASE_URL configurado):
Execute `importarBaseRedeSupabase()` no menu da planilha.

### Opção B — Manual:
Na aba BASE_REDE, cole os dados nos campos: `lat | lng | sigla | tipo`

## 8. Testar o Telegram

1. Adicione o bot ao grupo/canal desejado
2. Execute `testarTelegram()` no menu da planilha
3. Verifique se a mensagem de teste chegou

## 9. Configurar triggers automáticos

Execute `configurarTriggers()` no menu da planilha.
Isso cria:
- **07:00** — Pipeline completo (geocodificação + rede + alertas D0 + export)
- **23:00** — Alertas D-1 (véspera)

## 10. Criar repositório GitHub Pages

```bash
# Crie o repo no GitHub: Lidiomar90/troca-postes
# Depois:
cd TROCA-POSTES
git init
git add .
git commit -m "feat: init troca-postes"
git remote add origin https://github.com/Lidiomar90/troca-postes.git
git push -u origin main
```

No GitHub: Settings → Pages → Source: **main** → pasta: **/ (root)**

O site ficará em: https://lidiomar90.github.io/troca-postes/site/

## 11. GitHub Personal Access Token

Para o Apps Script fazer push do JSON:
1. github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Permissões: `Contents: Read and write` para o repo `troca-postes`
3. Copie o token e adicione como `GITHUB_TOKEN` nas Script Properties

## 12. Fluxo operacional

1. Equipe preenche a aba TROCAS com novas ordens (status = PENDENTE)
2. Script roda às 07:00 automaticamente:
   - Geocodifica endereços sem coords
   - Calcula proximidade à rede óptica
   - Envia alertas D0 (trocas de hoje)
   - Exporta JSON para o site
3. Script roda às 23:00: envia alertas D-1 (trocas de amanhã)
4. Equipe de campo atualiza status para EXECUTADO após a troca

## Estrutura das colunas (aba TROCAS)

| Coluna | Campo          | Preenchido por |
|--------|----------------|----------------|
| A      | ID             | Usuário        |
| B      | DATA_TROCA     | Usuário        |
| C      | LOGRADOURO     | Usuário        |
| D      | NUMERO         | Usuário        |
| E      | BAIRRO         | Usuário        |
| F      | CIDADE         | Usuário        |
| G      | UF             | Usuário (padrão MG) |
| H      | CEP            | Usuário (opcional) |
| I      | TIPO_POSTE_OLD | Usuário        |
| J      | TIPO_POSTE_NEW | Usuário        |
| K      | RESPONSAVEL    | Usuário        |
| L      | STATUS         | Usuário        |
| M      | OBS            | Usuário        |
| N      | LAT            | **Automático** |
| O      | LNG            | **Automático** |
| P      | GEO_STATUS     | **Automático** |
| Q      | REDE_STATUS    | **Automático** |
| R      | REDE_DIST_M    | **Automático** |
| S      | ALERTA_D1_SENT | **Automático** |
| T      | ALERTA_D0_SENT | **Automático** |
| U      | PROC_EM        | **Automático** |

## Limites de proximidade da rede

- ≤ 150m → **REDE PRÓXIMA** 🟢 (poste em área com rede, risco de impacto)
- 151–250m → **ATENÇÃO** 🟡 (verificar necessidade de proteção)
- > 250m → **SEM REDE** 🔴 (área sem cobertura de fibra próxima)

## Troubleshooting

**Telegram não envia:**
- Verifique se o bot foi adicionado ao grupo com permissão de enviar mensagens
- Confirme TELEGRAM_CHAT_ID (use @userinfobot para grupos)
- Execute `testarTelegram()` para diagnosticar

**Geocoding falhando:**
- Endereço muito incompleto → adicione bairro/cidade/UF
- Google Maps cota esgotada → script usa Nominatim como fallback
- Coloque manualmente LAT/LNG e defina GEO_STATUS = "OK"

**JSON não atualiza no site:**
- Verifique GITHUB_TOKEN e permissões do token
- Confirme GITHUB_REPO = "Lidiomar90/troca-postes" (sem https://)
- Veja log em LOG_EXECUCAO na planilha
