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

- Node 22 LTS (funciona em 20), Express 4, SQLite pelo cliente libSQL (`@libsql/client`): Turso na Vercel, arquivo `DATA_DIR/app.db` localmente.
- Frontend em HTML, CSS e JS puros com ES modules, servidos como estáticos. Sem build, sem CDN.
- `server/app.js` monta o app sem abrir porta (usado pelos testes); `server/index.js` só liga o servidor.
- Migrações numeradas em `server/db.js`, controladas pela tabela `_migrations`. Rodam ao abrir o banco.
- Datas de negócio só via `server/lib/date.js` (`todayKey`, `nowISO`, `dateKey`, `isDateKey`, `weekdayOf`).
- Testes com `node:test` + `supertest`, banco em arquivo temporário por teste.

## 5. Decisões tomadas

Cada linha: decisão — justificativa.

1. **Fases 0 e 1 entregues juntas** — o Erik pediu para seguir sem parar entre as duas; as perguntas foram respondidas depois (seção 7).
2. **`bcryptjs` em vez de `bcrypt`** (mesmo algoritmo, custo 10) — evita compilação nativa no Windows (o `better-sqlite3` depois deu lugar ao libSQL, decisão 63).
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
28. **`POST /api/day/:date/close` exige saída registrada**, marca "Fechar o dia" e trava o dia.
29. **Gestora consulta `GET /api/day/:date` da funcionária** (por `?user_id` ou a primeira funcionária ativa), só leitura — base para o detalhe do dia na Fase 4.
30. **Faixa de bônus compara o percentual inteiro** (94,9% é Prata) — o brief define as faixas em inteiros (88% a 94%).
31. **`/api/me` devolve também `today`** — o app usa a data do servidor, no fuso da loja, em vez do relógio do aparelho.

32. **Enviar a foto marca a tarefa** — tarefa com foto obrigatória recusa `PUT` sem foto (`409 photo_required`); um só gesto para a funcionária.
33. **Tipo do arquivo conferido pela assinatura do conteúdo**, além do tipo declarado — um `.txt` renomeado para `.jpg` é recusado (`415`).
34. **Foto nova substitui a anterior e desmarcar apaga o arquivo** — não acumula arquivo órfão; só vale para o dia de hoje, então o histórico não perde foto.
35. **Pasta do mês (`AAAA-MM`) vem da data do dia**, não do relógio — fotos de um dia ficam juntas.
36. **Foto servida por `GET /api/day/:date/tasks/:taskId/photo`**, com sessão; funcionária vê as próprias, gestora vê todas.
37. **Resumo do WhatsApp montado no servidor** (`summary.text` e `summary.whatsapp_url` na resposta do dia) — mesmo texto em qualquer aparelho e testável.
38. **Fechar o dia passa por uma tela de conferência** com as pendências antes de confirmar — o fechamento é irreversível para a funcionária.

39. **Fase 5 feita antes da Fase 4** — o Erik escolheu priorizar o cadastro de tarefas.
40. **O editor salva o checklist inteiro do dia** (`PUT`) como nova versão; tarefas recebem ids novos e os dias registrados seguem no snapshot antigo.
41. **"Aplicar também a" outros dias de expediente** (`also_weekdays`) — o checklist é quase igual de segunda a sexta; cada dia mantém o próprio foco de limpeza.
42. **Nova rota `POST /api/manager/checklist/:weekday/restore`** para o botão "restaurar padrão" — o brief pede o botão, mas não lista a rota.
43. **Roteiro com `GET /api/manager/posts`, `POST` e `DELETE`**, além do `GET/PUT /:id` do brief — sem eles não há como cadastrar o roteiro enquanto o protótipo não chega. Exclusão é lógica (`active = 0`).
44. **Mais de um post por horário é permitido** ("adicionar outra opção") — dá alternativa de texto para a funcionária.
45. **Tarefas automáticas (entrada, saída, fechamento) têm texto e pontos editáveis, mas o tipo não muda no editor** — evita quebrar o ponto por engano; cada tipo aparece no máximo uma vez.
46. **Ajustes incluem os dias de expediente** e o bônus aceita vírgula decimal.
47. **Toda alteração da gestora (checklist, restaurar, ajustes, roteiro) grava `audit_log`.**
48. **Gestão em abas Tarefas, Roteiro e Ajustes**; o Painel entra como primeira aba na Fase 4.

49. **Números do painel só contam dias encerrados** (fechados no app ou anteriores a hoje, com pelo menos um check) — o dia em andamento derrubaria a adesão; ele aparece no histórico como "Em andamento".
50. **"Sem registro" conta dias de expediente já passados sem nenhum check**, desde o início do período ou, em "Tudo", desde o cadastro da funcionária — mostra faltas sem misturar com a adesão (resposta 5).
51. **Ranking de falhas agrupa a tarefa pelo texto do template** (o snapshot agora guarda `template_text`, com `{foco}`) — a limpeza do foco é a mesma tarefa em todos os dias, mesmo com focos diferentes.
52. **Bônus estimado = bônus-base × percentual da faixa**, só exibido.
53. **Cartão "Hoje" do painel se atualiza a cada 5 s** enquanto a aba está visível — atende ao aceite de ver o registro em menos de 5 segundos.
54. **Detalhe do dia reaproveita `GET /api/day/:date`** com a sessão da gestora; fotos ampliam num `<dialog>`.
55. **Rotas do painel aceitam `?user_id`** e, sem ele, usam a primeira funcionária ativa — a interface é de uma funcionária, mas o modelo não impede outras.

56. **CSV com `;` e vírgula decimal**, BOM UTF-8 e `\r\n` — abre certo no Excel em português sem importação manual.
57. **Backup JSON sem a tabela `sessions` e sem as fotos** — sessões são descartáveis; fotos são binárias e vão no `backup.sh` (Fase 7).
58. **`npm run restore` só restaura em banco vazio** e recusa backup de versão de banco mais nova — evita misturar dados.

59. **Visual refeito a partir da logo da Nil** (pedido do Erik, 23/10): rosa-pink, magenta e blush no lugar do vinho e dourado do brief; tom mais leve e jovem para a funcionária, com mensagens de incentivo ("Faltam X pontos", "Meta batida!") e contador por bloco. Contraste AA conferido nos textos; o rosa claro fica só em elementos decorativos.
60. **Fontes Nunito e Great Vibes servidas pelo próprio app** (`public/fonts`, licença OFL) — sem CDN, como o brief exige; Great Vibes só nos títulos curtos do cabeçalho.
61. **Logo em `public/img/logo.jpg` (320 px, 23 KB)** e ícones derivados — dentro do limite de 300 KB por imagem.

62. **Deploy na Vercel em vez de VPS** (pedido do Erik, 23/10) — substitui a Fase 7 e a pasta `deploy/`. `api/index.js` exporta o app Express como função; `vercel.json` serve `public/` como estático.
63. **Banco no Turso via `@libsql/client`** no lugar de `better-sqlite3`: a Vercel não persiste arquivos. Todo acesso ao banco virou assíncrono; transações usam `db.transaction` e `db.batch`. Localmente e nos testes o mesmo cliente abre um arquivo.
64. **Migrações controladas pela tabela `_migrations`** — o Turso não garante `PRAGMA user_version`.
65. **Fotos no Vercel Blob** com nome aleatório (UUID); o endereço do Blob nunca vai ao navegador: a rota autenticada busca a imagem e repassa. Só aceita endereços `*.blob.vercel-storage.com`. Localmente continuam em `DATA_DIR/uploads`.
66. **`trust proxy` = 1 salto na Vercel** (IP real do cliente para o limite de login, sem aceitar `X-Forwarded-For` forjado); fora dela, só `loopback`.
67. **Seed automático na Vercel** quando `MANAGER_EMAIL` e `MANAGER_PASSWORD` estão definidas — o Erik não precisa de Node no computador. O seed é idempotente.

68. **Horário por tarefa** (pedido do Erik, 23/10): campo opcional `due_time`. Feita mais de 15 minutos depois conta como atrasada, **sem perder pontos** (escolha do Erik). O painel mostra a porcentagem feita no horário; a tela Hoje ordena por horário e marca "Atrasada".
69. **Postagens do dia numa tarefa só**: a tarefa com `posts = 1` recebe no snapshot o roteiro da data (1 a 10 postagens). Cada postagem é marcada à parte (`post_checks`); os pontos se dividem entre elas (arredondados para baixo) e a tarefa fica marcada quando todas estão feitas. A migração 3 juntou os três posts antigos nessa tarefa.
70. **Roteiro em prompts para o ChatGPT**: cada postagem tem horário, tipo, objetivo, prompt da imagem e prompt do texto, com botões Copiar e Abrir no ChatGPT (`chatgpt.com/?q=`). O **estilo da marca** (Ajustes) entra no fim de todo prompt de imagem.
71. **Programação por data**: postagem com `date` vale só naquele dia e substitui a semana padrão. O editor tem calendário do mês, "Personalizar este dia", "Copiar para outros dias" e "Voltar ao roteiro padrão". As tarefas do checklist continuam por dia da semana.
72. **Roteiro padrão criado pelo seed uma vez só** (3 postagens por dia útil, com prompts de exemplo), marcado em `settings.roteiro_padrao_criado`.

## 6. Pendências

- **Protótipo `checkpoint-nil/index.html` não foi enviado.** Sem ele faltam: os 19 registros do roteiro de posts (tabela `posts` está vazia), subtítulos das seções e referências de texto e layout. Quando chegar, vai para `referencia/prototipo.html`.
- Deploy: falta o Erik criar o banco no Turso, conectar o Blob e cadastrar as variáveis (README, seção Deploy na Vercel). Blob conectado e variáveis do Turso cadastradas em 23/10; faltam as da gestora e o redeploy.

## 7. Perguntas respondidas (23/10/2026)

1. **Bônus-base:** `0` até a gestora configurar.
2. **Protótipo:** será enviado. Até lá o roteiro de posts fica vazio.
3. **Ponto automático:** sim. Check-in e check-out marcam as tarefas de bater ponto.
4. **Fim de semana:** não há expediente no sábado nem no domingo. A adesão considera só segunda a sexta.
5. **Falta da funcionária:** o dia fica sem registro. A gestora só corrige o passado pela rota de correção, com `audit_log`.

## 8. Adendo ao brief: ponto por etiqueta NFC (pedido do Erik, 23/10/2026)

Objetivo: provar que a entrada e a saída foram registradas na loja, sem app nativo e sem hardware além de uma etiqueta NFC comum.

- A etiqueta, colada na loja, guarda um link do app: `https://<domínio>/ponto/<código>`. O código é aleatório (32 caracteres) e fica em `settings.nfc_token`.
- Encostar o celular na etiqueta abre o link no navegador (iPhone e Android leem etiquetas com link sem instalar nada). Se a funcionária não estiver logada, entra com o PIN e o app segue o registro em seguida.
- Sem entrada registrada, o app registra a entrada na hora. Com entrada e sem saída, pede confirmação antes de registrar a saída, para um toque acidental não encerrar o turno. Com as duas registradas, só informa.
- A gestora liga em Ajustes a opção **"Exigir a etiqueta para registrar entrada e saída"** (`settings.ponto_exige_nfc`). Ligada, o servidor recusa entrada e saída sem o código certo (`409 nfc_required` ou `409 nfc_invalid`), e o botão comum dá lugar à instrução de encostar o celular na etiqueta. Desligada, os dois caminhos funcionam.
- Em Ajustes, a gestora vê o link para gravar na etiqueta e pode **gerar um novo código**, o que invalida a etiqueta antiga (útil se o link vazar ou a etiqueta for trocada).
- Para gravar: app gratuito NFC Tools (Android ou iPhone) → Escrever → Adicionar registro → URL → colar o link → Escrever e encostar a etiqueta.
- O código entra no backup JSON (tabela `settings`): restaurar mantém a etiqueta funcionando.
- Limite conhecido: quem copiar o link consegue registrar fora da loja. O link fica só na etiqueta e pode ser trocado a qualquer momento; não há verificação de localização.
