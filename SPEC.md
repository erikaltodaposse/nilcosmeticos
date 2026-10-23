# SPEC — Checkpoint Nil

Especificação derivada do brief (`PROMPT.md`). O brief continua sendo a fonte da verdade; este arquivo registra
o entendimento, as decisões pequenas tomadas durante a implementação e as perguntas em aberto.

## 1. Resumo

Aplicação web mobile-first para a loja Nil Cosméticos (Manaus, uma unidade). A funcionária do turno da tarde
(13h às 18h) registra ponto, checklist diário com fotos das limpezas, posts do roteiro e fechamento do dia.
A gestora confere adesão, histórico com fotos e falhas recorrentes, edita o checklist e exporta relatórios.
O objetivo é trocar cobrança pessoal por conferência de registro.

## 2. Perfis

| Papel | Entrada | Pode |
| --- | --- | --- |
| employee | PIN de 4 a 6 dígitos | Próprio dia: check-in, check-out, marcar tarefa, anexar foto, fechar dia, trocar PIN |
| manager | e-mail e senha | Tudo do employee + painel, edição de checklist, roteiro, configurações, exportação |

Sem cadastro público. Usuários vêm do `npm run seed`. A funcionária nasce com PIN `1234` e é obrigada a trocá-lo
no primeiro acesso: até trocar, a API só responde `/api/me`, `/api/auth/change-pin` e `/api/auth/logout`
(as outras devolvem `403 pin_change_required`).

## 3. Regras de negócio (resumo do brief, seção 7)

- Meta diária de 150 pontos (`settings.meta_pontos`). 14 tarefas em 4 blocos somam 150.
- `pontos_dia` = soma das tarefas marcadas **no snapshot do dia**.
- `adesão` = pontos totais / (dias trabalhados × meta). Dia trabalhado = `day_records` com pelo menos um check.
- Expediente de segunda a sexta (`settings.dias_expediente = 1,2,3,4,5`). Sábado e domingo não têm expediente.
- Faixas: Ouro ≥ 95%, Prata 88–94%, Bronze 80–87%, Abaixo < 80%. Só cálculo e exibição.
- Snapshot congelado no primeiro registro do dia. Leitura de dia sempre pelo snapshot. Editar checklist cria nova
  versão. Exceção: dia de hoje totalmente vazio pode ter o snapshot regravado.
- Foco de limpeza por dia da semana substitui `{foco}` no texto da tarefa.
- Três janelas de post (13:30, 15:30, 17:00) e uma linha de produto por dia.
- "A loja nunca fica sozinha" é aviso fixo, não tarefa. Saída após 18h + 10 min de tolerância é sinalizada.
- Nenhuma rota altera `task_checks` de dias anteriores; correção do passado só pela gestora, com `audit_log`.

## 4. Arquitetura

- Node 22 LTS (funciona em 20), Express 4, SQLite via `better-sqlite3` em `DATA_DIR/app.db`.
- Frontend em HTML, CSS e JS puros com ES modules, servidos como estáticos. Sem build, sem CDN.
- `server/app.js` monta o app sem abrir porta (usado pelos testes); `server/index.js` só liga o servidor.
- Migrações numeradas em `server/db.js`, controladas por `PRAGMA user_version`. Rodam ao abrir o banco.
- Datas de negócio só via `server/lib/date.js` (`todayKey`, `nowISO`, `dateKey`, `isDateKey`, `weekdayOf`).
- Testes com `node:test` + `supertest`, banco `:memory:` por teste.

## 5. Decisões tomadas

Cada linha: decisão — justificativa.

1. **Fases 0 e 1 entregues juntas** — o Erik pediu para seguir sem parar entre as duas; as perguntas foram respondidas depois (seção 7).
2. **`bcryptjs` em vez de `bcrypt`** (mesmo algoritmo, custo 10) — evita compilação nativa no Windows; `better-sqlite3` já tem binário pronto.
3. **Sessão em tabela `sessions` no SQLite**, cookie `sid` assinado com `SESSION_SECRET` (via `cookie-parser`) — sobrevive a reinício do servidor sem dependência extra; o banco guarda só o SHA-256 do token.
4. **Tabela `sessions` acrescentada ao modelo** — o modelo do brief não tinha onde guardar sessão.
5. **Sessão dura 14 dias** — o celular é da funcionária; evita digitar PIN todo dia sem deixar sessão eterna.
6. **Cookie `secure` só com `NODE_ENV=production`** — em desenvolvimento o teste no celular é por `http://IP:3000`, onde cookie `secure` não seria gravado.
7. **Rate limit conta só tentativas erradas** (5 por 5 min por IP, PIN e senha somados) — login certo não deveria travar quem acabou de errar uma vez.
8. **`trust proxy = loopback`** — atrás do Caddy na mesma máquina, o limite precisa do IP real do cliente e não aceita `X-Forwarded-For` de fora.
9. **Login por PIN sem escolher usuário** — há uma funcionária; o servidor compara o PIN com cada funcionária ativa. Na troca, PIN igual ao de outra funcionária é recusado.
10. **Novo PIN precisa ser diferente do atual** — senão a troca obrigatória vira formalidade.
11. **`MANAGER_PASSWORD` com no mínimo 8 caracteres** — o seed recusa senha curta.
12. **Seed idempotente**: não sobrescreve gestora, funcionária, configurações nem checklist existentes — pode rodar de novo em produção sem perder dados.
13. **Checklist semeado para os 7 dias**, mesmo sem expediente no fim de semana — se um dia a loja abrir no sábado, basta incluir o dia em `dias_expediente`; os focos de sábado e domingo do brief ficam guardados.
14. **Tarefa de limpeza do salão gravada como `Limpeza do foco do dia: {foco}`** — o brief pede o marcador `{foco}` em alguma tarefa; esta é a única que faz sentido.
15. **`bonus_base` semeado como `0`** — resposta 1: zero até a gestora configurar.
16. **Novas variáveis `MANAGER_NAME` e `EMPLOYEE_NAME`** no `.env.example` — o brief pede nome configurável para a funcionária.
17. **Seções semeadas sem subtítulo** — os subtítulos estão no protótipo, que não chegou.
18. **`store_id` não incluído** — o brief deixa opcional e a interface é de loja única; uma migração futura acrescenta se precisar.
19. **Texto secundário usa `#6E5A5D`** em vez do muted `#8A7376` — o muted sobre branco fica abaixo de AA (≈4,3:1) para texto pequeno; `#8A7376` fica para elementos decorativos.
20. **Títulos em Georgia/serifa do sistema** — sem CDN não dá para carregar fonte externa; a fonte própria pode ir para `public/` depois, se o protótipo usar uma.
21. **Erros de API sempre `{ error, message }`**, inclusive 404 de rota `/api/*` desconhecida e JSON malformado.
22. **`GET /api/manager/settings` adiantado da Fase 5** — é leitura simples e permite testar já na Fase 1 que a funcionária não acessa rota de gestora.
23. **Nova configuração `dias_expediente`** (padrão `1,2,3,4,5`) — resposta 4; a tela Hoje e o check-in vão recusar dia sem expediente.
24. **Check-in e check-out marcam sozinhos "Bater ponto de entrada" e "Bater ponto de saída"** — resposta 3; essas tarefas não terão botão próprio.

25. **Coluna `checklist_tasks.auto`** (migração 2: `check_in`, `check_out`, `close`) — identifica as tarefas marcadas pelo sistema sem depender do texto; essas tarefas recusam marcação manual (`409 auto_task`).
26. **Abrir a tela de hoje já cria o registro do dia e congela o snapshot** — o brief 7.2 inclui "abertura da tela do dia"; dia sem nenhum check não conta como trabalhado.
27. **Rotas de escrita só aceitam a data de hoje e dia com expediente** (`409 not_today`, `409 no_workday`) — garante a imutabilidade do passado (7.6).
28. **`POST /api/day/:date/close` adiantado da Fase 3, em versão simples** — exige saída registrada, marca "Fechar o dia" e trava o dia; sem ele o aceite "14 tarefas = 150 pontos" não fecha. A Fase 3 acrescenta a exigência de foto e o resumo para WhatsApp.
29. **Foto ainda não é exigida para marcar as limpezas** — a exigência e o upload são da Fase 3; a tela já mostra a etiqueta "Exige foto".
30. **Gestora consulta `GET /api/day/:date` da funcionária** (por `?user_id` ou a primeira funcionária ativa), só leitura — base para o detalhe do dia na Fase 4.
31. **Faixa de bônus compara o percentual inteiro** (94,9% é Prata) — o brief define as faixas em inteiros (88% a 94%).
32. **`/api/me` devolve também `today`** — o app usa a data do servidor, no fuso da loja, em vez do relógio do aparelho.

## 6. Pendências

- **Protótipo `checkpoint-nil/index.html` não foi enviado.** Sem ele faltam: os 19 registros do roteiro de posts (tabela `posts` está vazia), subtítulos das seções e referências de texto e layout. Quando chegar, vai para `referencia/prototipo.html`.
- Pasta `deploy/` fica para a Fase 7, como no plano do brief.

## 7. Perguntas respondidas (23/10/2026)

1. **Bônus-base:** `0` até a gestora configurar.
2. **Protótipo:** será enviado. Até lá o roteiro de posts fica vazio.
3. **Ponto automático:** sim. Check-in e check-out marcam as tarefas de bater ponto.
4. **Fim de semana:** não há expediente no sábado nem no domingo. A adesão considera só segunda a sexta.
5. **Falta da funcionária:** o dia fica sem registro. A gestora só corrige o passado pela rota de correção, com `audit_log`.
