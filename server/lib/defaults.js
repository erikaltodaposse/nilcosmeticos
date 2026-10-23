// Valores padrão da loja (brief, seções 7.1 e 7.3). Usados pelo seed e, depois, por "restaurar padrão".

export const DEFAULT_SETTINGS = {
  meta_pontos: '150',
  turno_inicio: '13:00',
  turno_fim: '18:00',
  bonus_base: '0',
  nome_loja: 'Nil Cosméticos',
  // Dias da semana com expediente (0 = domingo). A loja não abre sábado nem domingo.
  dias_expediente: '1,2,3,4,5',
};

// Índice = dia da semana (0 = domingo).
export const DEFAULT_CLEANING_FOCUS = [
  'loja fechada',
  'hall principal e entrada',
  'hall e vitrine',
  'hall e banheiro',
  'hall e entrada',
  'hall, entrada e fachada',
  'hall e vitrine',
];

// A tarefa com {foco} recebe o foco de limpeza do dia na hora de montar o snapshot.
export const DEFAULT_SECTIONS = [
  {
    title: 'Chegada',
    subtitle: null,
    tasks: [
      { text: 'Bater ponto de entrada', points: 10 },
      { text: 'Abrir a loja: luzes, som, vitrine e balcão', points: 5 },
      { text: 'Postar "Boa tarde" no Grupo VIP', points: 15 },
      { text: 'Conferir caixa, troco e organização do balcão', points: 5 },
    ],
  },
  {
    title: 'Salão',
    subtitle: null,
    tasks: [
      { text: 'Limpeza do foco do dia: {foco}', points: 20, requires_photo: true },
      { text: 'Reposição e organização de gôndolas (15 min)', points: 10 },
    ],
  },
  {
    title: 'Conteúdo',
    subtitle: null,
    tasks: [
      { text: 'Post 1 — 13:30 — Grupo VIP', points: 10, post_slot: 1 },
      { text: 'Post 2 — 15:30 — Stories/Status', points: 10, post_slot: 2 },
      { text: 'Post 3 — 17:00 — Feed ou TikTok', points: 10, post_slot: 3 },
    ],
  },
  {
    title: 'Fechamento',
    subtitle: null,
    tasks: [
      { text: 'Limpeza final: hall e entrada', points: 20, requires_photo: true },
      { text: 'Fechamento de caixa e relatório do dia', points: 10 },
      { text: 'Apoiar o fechamento da loja com a gestora', points: 10 },
      { text: 'Bater ponto de saída', points: 10 },
      { text: 'Fechar o dia no app e enviar o resumo', points: 5 },
    ],
  },
];
