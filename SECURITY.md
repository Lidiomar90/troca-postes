# Política de Segurança

## Escopo
Este repositório contém automações, publicação de site e integração com Google Apps Script/Telegram para o projeto **troca-postes**.

## Princípios obrigatórios
- Nunca versionar tokens, chaves, segredos, cookies, certificados ou credenciais.
- Nunca publicar valores reais de `TELEGRAM_TOKEN`, `GITHUB_TOKEN`, `SUPABASE_ANON_KEY`, `.clasp.json`, `.clasprc.json` ou arquivos `.env`.
- Credenciais devem permanecer apenas em **Script Properties**, **GitHub Secrets** ou armazenamento local seguro.
- Tokens devem usar o menor privilégio possível e acesso apenas ao repositório necessário.
- Em caso de suspeita de vazamento, revogar o segredo imediatamente e gerar um novo.

## Boas práticas para este projeto
1. Manter o repositório público apenas para código e documentação sem segredos.
2. Usar GitHub Fine-grained Personal Access Token com permissão mínima de `Contents: Read and write` somente neste repositório, se realmente necessário.
3. Não reutilizar tokens entre automações distintas.
4. Revisar antes de cada `git add .` para evitar envio acidental de arquivos locais.
5. Validar `.gitignore` sempre que novos scripts, relatórios ou arquivos de configuração forem criados.

## Como reportar um problema de segurança
Se identificar uma exposição de segredo, falha de autenticação, risco de publicação indevida ou comportamento inseguro:
1. Não publique o detalhe em issue pública.
2. Revogue imediatamente o segredo afetado.
3. Corrija o código/configuração.
4. Registre internamente a ocorrência com data, impacto e ação corretiva.

## Resposta a incidente sugerida
- Revogar token/chave comprometido
- Gerar nova credencial
- Atualizar a origem segura da credencial
- Remover o segredo do histórico se necessário
- Revisar acessos e logs relacionados
