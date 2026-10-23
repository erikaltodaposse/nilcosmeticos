# Checkpoint Nil

Sistema de rotina e conferência da loja Nil Cosméticos. A funcionária registra ponto, checklist e fotos pelo
celular; a gestora confere tudo pelo painel. Detalhes de escopo e decisões em [`SPEC.md`](SPEC.md);
o brief original está em [`PROMPT.md`](PROMPT.md).

> Estado atual: **Fases 1 a 6** (login, tela Hoje, fotos, fechamento com WhatsApp, painel, editor de tarefas, roteiro, ajustes, exportação e backup). O deploy (Fase 7) vem a seguir.

## Requisitos

- Node.js 22 LTS (funciona no 20 LTS).
- Nada mais: o SQLite vem embutido no pacote `better-sqlite3`.

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
| `TZ` | não | Use `America/Manaus`. O código já calcula datas nesse fuso de qualquer jeito. |

## Seed

`npm run seed` cria, se ainda não existirem:

- a gestora, com e-mail e senha do `.env`;
- a funcionária, com PIN `1234` e troca obrigatória no primeiro acesso;
- as configurações padrão (meta 150, turno 13:00–18:00, expediente de segunda a sexta);
- o checklist padrão de 14 tarefas (150 pontos) para cada dia da semana.

Pode rodar de novo sem perder nada: o que já existe não é sobrescrito.

## Banco e migrações

O banco fica em `DATA_DIR/app.db`. As migrações rodam sozinhas quando o servidor sobe; para rodar à parte,
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

## Deploy

Documentado na Fase 7 (pasta `deploy/`).
