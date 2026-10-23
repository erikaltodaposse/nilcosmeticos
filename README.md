# Checkpoint Nil

Sistema de rotina e conferência da loja Nil Cosméticos. A funcionária registra ponto, checklist e fotos pelo
celular; a gestora confere tudo pelo painel. Detalhes de escopo e decisões em [`SPEC.md`](SPEC.md);
o brief original está em [`PROMPT.md`](PROMPT.md).

> Estado atual: **Fases 1 a 6** (login, tela Hoje, fotos, fechamento com WhatsApp, painel, editor de tarefas, roteiro, ajustes, exportação e backup). O deploy (Fase 7) vem a seguir.

## Requisitos

- Node.js 22 LTS (funciona no 20 LTS).
- Nada mais: o banco é SQLite, aberto pelo pacote `@libsql/client` (sem compilação).

## Instalação (Windows, PowerShell)

```powershell
npm install
Copy-Item .env.example .env
notepad .env
```

No `.env`, para desenvolvimento:

- `NODE_ENV=development` (assim o cookie funciona por `http://` na rede local).
- `DATA_DIR=./data` (ou apague a linha; o padrão já é `./data`).
- `SESSION_SECRET`: gere com `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- `MANAGER_EMAIL` e `MANAGER_PASSWORD` (mínimo 8 caracteres) da gestora.

Depois:

```powershell
npm run seed
npm run dev
```

Abra `http://localhost:3000`. Para testar no celular, use `http://IP-DA-MAQUINA:3000` na mesma rede
(o IP aparece em `ipconfig`).

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `PORT` | não | Porta HTTP. Padrão `3000`. |
| `NODE_ENV` | não | `production` liga o cookie `secure` (exige HTTPS). |
| `DATA_DIR` | não | Pasta do banco (`app.db`) e das fotos (`uploads/`). Padrão `./data`. Criada automaticamente. |
| `SESSION_SECRET` | sim | Assina o cookie de sessão. Mínimo 32 caracteres; use 64 aleatórios. |
| `MANAGER_EMAIL` | no seed | E-mail de login da gestora. |
| `MANAGER_PASSWORD` | no seed | Senha da gestora, mínimo 8 caracteres. |
| `MANAGER_NAME` | não | Nome exibido da gestora. Padrão `Gestora`. |
| `EMPLOYEE_NAME` | não | Nome exibido da funcionária. Padrão `Funcionária`. |
| `TURSO_DATABASE_URL` | na Vercel | Endereço do banco no Turso (`libsql://...`). Em branco, usa o arquivo `DATA_DIR/app.db`. |
| `TURSO_AUTH_TOKEN` | na Vercel | Token de acesso ao banco do Turso. |
| `BLOB_STORE_ID` ou `BLOB_READ_WRITE_TOKEN` | na Vercel | Criadas sozinhas ao conectar um Vercel Blob ao projeto (a primeira usa OIDC). Sem nenhuma, as fotos ficam em `DATA_DIR/uploads`. |
| `TZ` | não | Use `America/Manaus`. O código já calcula datas nesse fuso de qualquer jeito. |

## Seed

`npm run seed` cria, se ainda não existirem:

- a gestora, com e-mail e senha do `.env`;
- a funcionária, com PIN `1234` e troca obrigatória no primeiro acesso;
- as configurações padrão (meta 150, turno 13:00–18:00, expediente de segunda a sexta);
- o checklist padrão de 14 tarefas (150 pontos) para cada dia da semana.

Pode rodar de novo sem perder nada: o que já existe não é sobrescrito.

## Banco e migrações

Localmente o banco fica em `DATA_DIR/app.db`; com `TURSO_DATABASE_URL` definida, fica no Turso. O acesso é pelo
cliente libSQL nos dois casos. As migrações rodam sozinhas quando o servidor sobe; para rodar à parte,
use `npm run migrate`.

## Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor com recarga automática (nodemon). |
| `npm start` | Servidor sem recarga. |
| `npm run seed` | Popula usuários, configurações e checklist. |
| `npm run migrate` | Aplica migrações pendentes. |
| `npm run restore -- arquivo.json` | Restaura um backup JSON num banco vazio. |
| `npm test` | Testes (`node:test` + `supertest`). |
| `npm run lint` | ESLint. |

## Ponto pela etiqueta NFC

Em **Gestão → Ajustes → Etiqueta NFC do ponto** aparece o link para gravar numa etiqueta NFC comum (com o app gratuito NFC Tools: Escrever → Adicionar registro → URL). Encostar o celular na etiqueta abre o app: a entrada é registrada na hora e a saída pede confirmação. Depois de testar, ligue **"Exigir a etiqueta para registrar entrada e saída"**: a partir daí o botão comum deixa de valer. "Gerar novo código" invalida a etiqueta antiga. Detalhes em `SPEC.md`, seção 8.

O link da etiqueta usa o domínio em que a gestora abriu o app. Em produção, gere e grave o link já pelo endereço `https://` definitivo.

## Exportação e backup pelo app

No Painel da gestora, o cartão **Exportar** tem:

- **Baixar planilha (CSV)**: um dia por linha no período escolhido, separado por `;`, com BOM UTF-8 (abre direto no Excel).
- **Baixar backup (JSON)**: todos os registros, tarefas, versões do checklist, ajustes, roteiro e log de auditoria. Não inclui sessões nem os arquivos das fotos.

## Restaurar um backup numa máquina limpa

1. Instale o projeto (`npm install`) e crie o `.env` como acima.
2. **Não** rode o seed: a restauração exige banco vazio.
3. Restaure: `npm run restore -- C:\caminho\checkpoint-backup-AAAA-MM-DD.json`
4. Copie a pasta de fotos (`uploads/`) do backup do servidor para `DATA_DIR/uploads/`.
5. Suba o servidor (`npm start`). Gestora e funcionária entram com as mesmas credenciais de antes.

O teste `tests/export.test.js` confere que painel, ranking, histórico e CSV saem idênticos depois da restauração.

## Deploy na Vercel

A Vercel não guarda arquivos entre uma requisição e outra, então o banco fica no **Turso** (SQLite na nuvem,
plano gratuito) e as fotos no **Vercel Blob**. O repositório já traz `vercel.json` e `api/index.js`; não há build.

1. **Banco no Turso.** Crie a conta em turso.tech, crie um banco (região mais próxima: `gru`, São Paulo) e copie
   o endereço `libsql://...` e um token (botão "Create Token" no painel do banco, ou
   `turso db show --url <nome>` e `turso db tokens create <nome>` na linha de comando).
2. **Fotos no Blob.** No projeto da Vercel, abra Storage, crie um Blob store e conecte ao projeto. A variável
   a Vercel cria sozinha a `BLOB_STORE_ID` (acesso por OIDC) ou, em contas antigas, a
   `BLOB_READ_WRITE_TOKEN`. O app aceita as duas.
3. **Variáveis.** Em Settings, Environment Variables, cadastre para Production:
   - `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` (passo 1);
   - `SESSION_SECRET` com 64 caracteres aleatórios (por exemplo, a saída de
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`);
   - `NODE_ENV` = `production`;
   - `NODEJS_HELPERS` = `0` (deixa o Express ler o corpo das requisições sem interferência da Vercel).
4. **Contas iniciais.** Cadastre também `MANAGER_EMAIL`, `MANAGER_PASSWORD` (mínimo 8 caracteres) e, se quiser,
   `EMPLOYEE_NAME`. Na primeira requisição o app cria as tabelas no Turso, a gestora, a funcionária (PIN `1234`,
   troca no primeiro acesso) e o checklist. Depois disso o seed não sobrescreve nada; trocar a senha nessa variável
   não muda a senha de uma gestora já criada. Rodar `npm run seed` do computador, com as variáveis do Turso, também
   funciona.
5. **Redeploy.** Em Deployments, refaça o último deploy para ele ler as variáveis novas. Se faltar alguma, as rotas
   `/api` respondem `server_not_configured` e o log da função diz qual.
6. **Etiqueta NFC.** Grave o link só depois, a partir de Ajustes, já no domínio final `https://...vercel.app`.

Observações: cada foto chega comprimida (cerca de 300 KB), bem abaixo do limite de 4,5 MB por requisição da Vercel.
O limite de tentativas de login é contado por instância da função. O backup JSON do app continua valendo; as
fotos ficam no Blob e podem ser baixadas pelo painel da Vercel.
