BRIEF — Sistema de Rotina e Conferência da Loja · Nil
Cosméticos
Como usar: salve este arquivo como PROMPT.md na raiz do repositório e abra o Claude Code com: leia

PROMPT.md e comece pela Fase 0

Se você tiver o protótipo checkpoint-nil/index.html do lado, copie para referencia/prototipo.html . Ele serve
como referência de identidade visual, textos e comportamento — não como código a ser reaproveitado.

1. Contexto
Loja de cosméticos e perfumaria em Manaus, uma unidade, equipe pequena. A gestora (Nil) tem uma funcionária no turno
da tarde, das 13h às 18h.
O problema não é técnico, é de processo: as regras hoje existem na cabeça da gestora. Sem registro, cada dia vira
negociação — limpeza que só acontece quando a funcionária quer, postagem que não sai, e atrito pessoal no lugar de
conversa sobre fato.
O sistema existe para tirar a gestora do papel de cobradora: ela passa a conferir registro, não a pessoa.
A versão anterior era um HTML com localStorage . Funcionava, mas os dados ficavam presos no aparelho da
funcionária. Agora vai ter servidor, então os dois celulares veem os mesmos dados.

2. Objetivo
Aplicação web mobile-first, multiusuário, com dois papéis:
Funcionária: bate ponto, cumpre checklist diário, anexa foto das limpezas, publica conteúdo seguindo roteiro, envia
resumo do dia.
Gestora: confere adesão, vê histórico com fotos, identifica tarefas que falham, edita o checklist e exporta relatórios.

3. Perfis e autenticação
Papel

Entrada

Permissões

employe
e

PIN numérico de 4 a 6

Próprio dia: check-in, check-out, marcar tarefa, anexar foto,

dígitos

fechar dia

manager

E-mail e senha

Tudo do employee + painel, edição de checklist, roteiro,
exportação

Sessão por cookie httpOnly , secure , sameSite=lax , assinado com SESSION_SECRET .
PIN e senha com hash bcrypt (custo 10).
Rate limit no login: 5 tentativas por 5 minutos por IP.
Sem cadastro público. Usuários criados por script de seed.
Toda rota de API valida papel no servidor. Nunca confiar no cliente.
Seed inicial ( npm run seed ):

manager : e-mail e senha vindos de variáveis de ambiente obrigatórias.
employee : PIN 1234 , nome configurável. Deve forçar troca no primeiro acesso.

4. Escopo do MVP
Entra:

1. Login por PIN (funcionária) e e-mail/senha (gestora).
2. Checklist do dia gerado por dia da semana.
3. Check-in e check-out com timestamp de servidor.
4. Marcar/desmarcar tarefa, com foto obrigatória em duas delas.
5. Pontuação e adesão.
6. Tela de fechamento com resumo e compartilhamento por WhatsApp.
7. Painel da gestora: KPIs, filtro de período, ranking de falhas, histórico com fotos.
8. Editor de checklist dentro do app.
9. Roteiro de postagens por dia da semana, com botão copiar.
10. Exportação CSV e backup JSON.
Fica de fora (não implementar agora):
Integração com ERP Nextar.
Envio automático por API do WhatsApp — usar https://wa.me/?text= .
Notificações push.
App nativo.
Múltiplas lojas. O modelo pode prever store_id , mas a interface é de loja única.

5. Stack e restrições
Runtime: Node.js 20 LTS ou 22 LTS.
Servidor: Express 4.
Banco: SQLite via better-sqlite3 , arquivo em DATA_DIR/app.db . Se a instalação falhar no Windows, use

node:sqlite e registre a decisão no README.
Frontend: HTML + CSS + JavaScript puro, ES modules, sem build step, sem framework, sem CDN. O servidor entrega
arquivos estáticos.
Testes: node:test + supertest .
Lint: ESLint com configuração mínima.
Timezone: todas as datas de negócio em America/Manaus . Nunca usar new Date().toISOString() para decidir
"que dia é hoje". Centralize em um único módulo lib/date.js com todayKey() , nowISO() e dateKey(date) .
Portabilidade: o código roda igual no Windows (desenvolvimento) e no Linux (VPS). Nenhum caminho absoluto
hardcoded; tudo via path.join e variáveis de ambiente.
Sem segredos no código. .env.example versionado, .env no .gitignore .

Estrutura de pastas
/
package.json
.env.example
.gitignore
README.md
PROMPT.md
server/
index.js
db.js
seed.js
lib/date.js
lib/points.js
lib/snapshot.js
lib/auth.js

routes/auth.js
routes/day.js
routes/posts.js
routes/manager.js
public/
index.html
css/app.css
js/app.js
js/api.js
js/views/*.js
img/
data/

(gitignored)

app.db
uploads/
tests/
points.test.js
snapshot.test.js
api.test.js
deploy/
checkpoint.service
Caddyfile
backup.sh

6. Modelo de dados
users (
id INTEGER PK, name TEXT, role TEXT CHECK(role IN ('employee','manager')),
email TEXT UNIQUE NULL, pin_hash TEXT NULL, password_hash TEXT NULL,
must_change_pin INTEGER DEFAULT 0, active INTEGER DEFAULT 1, created_at TEXT
)
settings (key TEXT PK, value TEXT)
-- meta_pontos, turno_inicio, turno_fim, bonus_base, nome_loja
checklist_versions (
id INTEGER PK, weekday INTEGER CHECK(weekday BETWEEN 0 AND 6),
version INTEGER, cleaning_focus TEXT, active INTEGER DEFAULT 1, created_at TEXT
)
checklist_sections (
id INTEGER PK, version_id INTEGER FK, position INTEGER, title TEXT, subtitle TEXT
)
checklist_tasks (
id INTEGER PK, section_id INTEGER FK, position INTEGER,
text TEXT, points INTEGER, requires_photo INTEGER DEFAULT 0,
post_slot INTEGER NULL, active INTEGER DEFAULT 1

)
day_records (
id INTEGER PK, user_id INTEGER FK, date TEXT,

-- YYYY-MM-DD em America/Manaus

check_in_at TEXT NULL, check_out_at TEXT NULL,
snapshot TEXT NOT NULL,

-- JSON congelado do checklist do dia

closed_at TEXT NULL, created_at TEXT,
UNIQUE(user_id, date)
)
task_checks (
id INTEGER PK, day_id INTEGER FK, task_id INTEGER,
done_at TEXT, photo_path TEXT NULL,
UNIQUE(day_id, task_id)
)
posts (
id INTEGER PK, weekday INTEGER, slot INTEGER, channel TEXT,
product_line TEXT, hook TEXT, caption TEXT, cta TEXT, active INTEGER DEFAULT 1
)
audit_log (id INTEGER PK, actor_id INTEGER, action TEXT, payload TEXT, created_at TEXT)

7. Regras de negócio — fonte da verdade
7.1 Pontuação
Meta diária padrão: 150 pontos. Configurável em settings.meta_pontos .
Bloco

Tarefa

Pontos

Chegada

Bater ponto de entrada

10

Chegada

Abrir a loja: luzes, som, vitrine e balcão

5

Chegada

Postar "Boa tarde" no Grupo VIP

15

Chegada

Conferir caixa, troco e organização do balcão

5

Salão

Limpeza do foco do dia

20

Salão

Reposição e organização de gôndolas (15 min)

10

Conteúdo

Post 1 — 13:30 — Grupo VIP

10

Conteúdo

Post 2 — 15:30 — Stories/Status

10

Conteúdo

Post 3 — 17:00 — Feed ou TikTok

10

Fechamento

Limpeza final: hall e entrada

20

Fechamento

Fechamento de caixa e relatório do dia

10

Foto

sim

sim

Bloco

Tarefa

Pontos

Fechamento

Apoiar o fechamento da loja com a gestora

10

Fechamento

Bater ponto de saída

10

Fechamento

Fechar o dia no app e enviar o resumo

5

Foto

Cálculos:

pontos_dia = soma dos pontos das tarefas marcadas no snapshot do dia
adesão = pontos_totais / (dias_trabalhados × meta)
dias_trabalhados = dias com day_records criado e pelo menos um check. Domingo não conta, salvo se a loja
abrir.
Faixas de bônus (apenas calculadas e exibidas; o pagamento é da gestora):
Faixa

Adesão

Bônus

Ouro

≥ 95%

100% do bônus-base

Prata

88% a 94%

75%

Bronze

80% a 87%

50%

Abaixo

< 80%

sem bônus

7.2 Congelamento do checklist (crítico)
O histórico nunca pode mudar quando o checklist é editado.
No primeiro registro do dia (check-in, primeira tarefa ou abertura da tela do dia), grave em day_records.snapshot
uma cópia profunda das seções e tarefas vigentes, com id , text , points , requires_photo , post_slot .
Toda leitura de um dia usa o snapshot, nunca o checklist atual.
Editar o checklist cria uma nova checklist_versions e passa a valer para dias seguintes.
Exceção: se o dia de hoje existe mas está completamente vazio (sem check-in, sem check-out, sem nenhum check), o
snapshot pode ser regravado ao salvar uma edição.
Escreva teste cobrindo: dia com snapshot de 150 pontos continua 150 depois de o template virar 400.

7.3 Escala de limpeza
O texto do foco do dia entra na tarefa que contém {foco} .
Dia

Foco

Segunda

hall principal e entrada

Terça

hall e vitrine

Quarta

hall e banheiro

Quinta

hall e entrada

Sexta

hall, entrada e fachada

Sábado

hall e vitrine

Dia

Foco

Domingo

loja fechada

7.4 Conteúdo
Três janelas fixas: 13:30 (Grupo VIP), 15:30 (Stories/Status), 17:00 (Feed ou TikTok). Uma linha de produto por dia: segunda
skincare, terça perfumaria feminina, quarta maquiagem, quinta capilar, sexta perfumaria masculina e presentes, sábado
corpo e kits. Semear a tabela posts com os 19 registros do protótipo. A tela do dia mostra o roteiro com botão "copiar".

7.5 Fechamento
A loja nunca fica sozinha. Isso é regra de conduta, exibida como aviso na tela — não é tarefa.
Se o fechamento passar das 18h, a funcionária permanece. O app registra o horário real de saída e sinaliza quando
passa da tolerância de 10 minutos, para a gestora acompanhar.

7.6 Imutabilidade
Nenhuma rota permite editar ou apagar task_checks de dias anteriores ao dia corrente. Corrigir o passado é feito
apenas pela gestora, com registro em audit_log .

8. API
Todas as respostas em JSON. Erros no formato { "error": "codigo", "message": "texto" } .
Métod

Rota

Papel

Descrição

POST

/api/auth/login/pin

público

{pin} → sessão

POST

/api/auth/login/password

público

{email,password} → sessão

POST

/api/auth/logout

autenticad

encerra

o

o
GET

/api/me

autenticad

usuário atual

o
POST

/api/auth/change-pin

employee

troca o PIN

GET

/api/day/:date

autenticad

dia + snapshot + checks + posts do dia da

o

semana

POST

/api/day/:date/checkin

employee

cria dia e congela snapshot

POST

/api/day/:date/checkout

employee

grava saída

PUT

/api/day/:date/tasks/:taskId

employee

marca tarefa

DELETE

/api/day/:date/tasks/:taskId

employee

desmarca

POST

/api/day/:date/tasks/:taskId/p
hoto

employee

multipart, campo photo

POST

/api/day/:date/close

employee

fecha o dia

Métod

Rota

Papel

Descrição

GET

/api/manager/summary?
from&to

manager

KPIs, faixas, séries

GET

/api/manager/days?from&to

manager

lista para histórico

GET

/api/manager/failures?
from&to

manager

ranking de tarefas não cumpridas

GET

/api/manager/export.csv?
from&to

manager

CSV com BOM UTF-8

GET

/api/manager/backup.json

manager

dump completo

GET/PU

manager

ler e salvar template

T

/api/manager/checklist/:week
day

GET/PU

/api/manager/posts/:id

manager

editar roteiro

/api/manager/settings

manager

meta, turno, bônus

o

T
GET/PU
T
Validação: date no formato YYYY-MM-DD ; taskId inteiro; upload apenas image/jpeg ou image/png ,
máximo 5 MB, renomeado com UUID e gravado em DATA_DIR/uploads/AAAA-MM/ . Servir foto por rota
autenticada, nunca por pasta pública.

9. Telas
Mobile-first, 360 px de largura mínima, sem scroll horizontal, alvos de toque de no mínimo 44 px.
1. Login — dois modos: PIN (funcionária) e e-mail/senha (gestora).
2. Hoje — data, turno, anel de progresso, pontos, horários de entrada e saída, aviso fixo da regra da loja, blocos com
tarefas, botão de foto quando exigida, botão "ver roteiro" nas tarefas de conteúdo, botão "fechar o dia".
3. Roteiro — três cards do dia com gancho, legenda e CTA, botão copiar e botão enviar no WhatsApp.
4. Meus pontos — pontos do mês, faixa atual, últimos dias.
5. Painel da gestora — KPIs, filtro de 7/30/tudo, ranking de falhas, histórico com barra e abertura do dia com fotos,
botões de exportar.
6. Editar checklist — turno, meta, nome, foco por dia, blocos e tarefas com reordenar, excluir, adicionar; salvar; restaurar
padrão.
7. Detalhe do dia — tarefas cumpridas com horário, pendentes, fotos ampliáveis.
Identidade visual, herdada do protótipo:
Vinho #2B1216 e #4A1A22 , dourado #C9A227 , creme #F8F3EC , texto #241417 , muted #8A7376 .
Cards com raio 20 px, sombra suave, cabeçalho escuro, tipografia serifada nos títulos.
Português do Brasil com acentuação correta. Sem emojis.
Estados vazios escritos com frases úteis, não "nenhum dado".
Feedback de erro sempre em texto claro, nunca só cor.

10. Requisitos não funcionais
Primeira renderização abaixo de 2 s em 3G rápido; nenhuma imagem acima de 300 KB.

Fotos comprimidas no cliente antes do upload: lado maior 1280 px, JPEG qualidade 0.7.
Funcionar em Chrome Android, Safari iOS 15+ e Chrome desktop.
Contraste mínimo AA; labels associados aos inputs; foco visível.
Logs de servidor sem dados sensíveis.

README.md com instalação, variáveis de ambiente, seed, testes, deploy e backup.
Commits pequenos por fase, mensagens no imperativo, em português.

11. Testes e critérios de aceite
Obrigatórios antes de cada checkpoint:

npm test
npm run lint

Cobertura mínima de testes:
1. points.test.js — soma de 14 tarefas = 150; dia parcial; tarefa removida do template não afeta dia antigo.
2. snapshot.test.js — editar checklist não altera dia já registrado; dia vazio aceita regravação.
3. api.test.js — login inválido barra; employee não acessa rota de manager; check-in cria snapshot; upload rejeita
arquivo não-imagem; exportação CSV tem cabeçalho correto.
Critérios de aceite do MVP:
Funcionária faz o dia inteiro no celular sem instrução verbal.
Gestora vê o dia da funcionária no computador em menos de 5 segundos após o registro.
Editar o checklist não muda nenhum número do passado.
Backup restaurável em uma máquina limpa seguindo apenas o README.

12. Plano de execução
Execute uma fase por vez e pare ao final de cada uma para eu revisar. Não avance sem meu "ok".
Fase 0 — Entendimento Leia este brief, crie o repositório, escreva o SPEC.md derivado dele, liste as decisões que
tomou e faça no máximo 5 perguntas. Aguarde.
Fase 1 — Esqueleto Estrutura de pastas, Express, SQLite, migrações, seed, login PIN e senha, sessão, /api/me . Tela de
login funcional. Aceite: consigo entrar com PIN 1234 e com a gestora; rota protegida devolve 401 sem sessão.
Fase 2 — Dia e checklist /api/day/:date , congelamento de snapshot, check-in/check-out, marcar e desmarcar, cálculo
de pontos. Tela "Hoje". Aceite: marcar as 14 tarefas fecha 150 pontos; o dia congela.
Fase 3 — Fotos e fechamento Upload com compressão no cliente, exigência de foto nas duas limpezas, rota autenticada
de imagem, fechamento com resumo e link do WhatsApp. Aceite: tarefa com foto obrigatória não fecha sem imagem.
Fase 4 — Painel da gestora Resumo, séries, ranking de falhas, histórico, detalhe do dia com fotos. Aceite: números batem
com o banco; ranking aponta a tarefa mais falha corretamente.
Fase 5 — Editor e roteiro Editor completo do checklist, foco de limpeza por dia, configurações, CRUD do roteiro. Aceite:
editar e salvar reflete no dia seguinte e não altera o passado.
Fase 6 — Exportação e polimento CSV, backup JSON, estados vazios, acessibilidade, revisão de textos, README final.

Aceite: backup restaurado em banco limpo reproduz os mesmos números.
Fase 7 — Deploy Arquivos em deploy/ , documentação de VPS, checklist de produção.

13. Deploy

13.1 Desenvolvimento no Windows
PowerShell. Nada de comandos bash.

npm install , npm run seed , npm run dev com nodemon .
Banco e uploads em ./data , criados automaticamente.
Testar no celular pela rede local: http://IP-DA-MAQUINA:3000 .

13.2 Produção na VPS (Linux)
Ubuntu 22.04 ou 24.04, usuário dedicado checkpoint sem privilégios.
Node 22 LTS via NodeSource.
App em /opt/checkpoint , dados em /var/lib/checkpoint ( DATA_DIR ), logs no journal.

systemd para o processo — não rode produção dentro do tmux.
Caddy como proxy reverso com HTTPS automático para o domínio.
ufw liberando apenas 22, 80 e 443. SSH por chave, senha desabilitada.
Entregue em deploy/ :

checkpoint.service

[Unit]
Description=Checkpoint Nil
After=network.target
[Service]
Type=simple
User=checkpoint
WorkingDirectory=/opt/checkpoint
EnvironmentFile=/opt/checkpoint/.env
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target

Caddyfile

checkpoint.seudominio.com.br {
encode gzip
reverse_proxy 127.0.0.1:3000
}

backup.sh — cópia diária às 3h via cron: sqlite3 app.db ".backup" , empacotar uploads/ , manter 14 dias.
.env.example

PORT=3000
NODE_ENV=production
DATA_DIR=/var/lib/checkpoint
SESSION_SECRET=troque-por-64-caracteres-aleatorios
MANAGER_EMAIL=
MANAGER_PASSWORD=
TZ=America/Manaus

13.3 Fluxo com tmux
O tmux é para a sua sessão remota, não para o serviço.

tmux new -s checkpoint
# Ctrl+B depois D
tmux ls

# criar
# desanexar

# listar

tmux attach -t checkpoint

# voltar

Durante o desenvolvimento remoto, rode npm run dev dentro do tmux. Em produção, use sudo systemctl restart

checkpoint e acompanhe com journalctl -u checkpoint -f .
Instrua no README a sequência completa de primeiro deploy: criar usuário, instalar Node, copiar código, .env , npm

ci , npm run seed , migrar, subir systemd, configurar Caddy, abrir firewall, testar HTTPS, configurar backup.

14. Convenções
Código e nomes em inglês; textos de interface em português.
Funções puras para pontos e snapshot, sem dependência de Express — é o que torna o teste fácil.
Nada de any implícito em parâmetros de borda: valide na entrada da rota.
Comentários apenas onde a intenção não é óbvia.

.gitignore : node_modules , .env , data/ , *.db , uploads/ .

15. Antes de começar
Se algo neste brief estiver ambíguo, pergunte antes de codar. Limite: 5 perguntas, agrupadas. Não invente requisito que
não está aqui; se precisar decidir algo pequeno, decida, implemente e registre a decisão no SPEC.md com uma linha de
justificativa.
Comece pela Fase 0.

