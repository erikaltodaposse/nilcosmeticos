# Checkpoint Nil

Sistema de rotina e conferência da loja Nil Cosméticos. A funcionária registra ponto, checklist e fotos pelo
celular; a gestora confere tudo pelo painel. Detalhes de escopo e decisões em [`SPEC.md`](SPEC.md);
o brief original está em [`PROMPT.md`](PROMPT.md).

> Estado atual: **Fase 1** (estrutura, banco, seed e login). As telas do dia e o painel chegam nas próximas fases.

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
| `npm test` | Testes (`node:test` + `supertest`). |
| `npm run lint` | ESLint. |

## Deploy e backup

Documentados na Fase 7 (pasta `deploy/`).
