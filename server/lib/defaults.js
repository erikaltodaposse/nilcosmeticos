// Valores padrão da loja (brief, seções 7.1 e 7.3). Usados pelo seed e, depois, por "restaurar padrão".

export const DEFAULT_SETTINGS = {
  meta_pontos: '150',
  turno_inicio: '13:00',
  turno_fim: '18:00',
  bonus_base: '0',
  nome_loja: 'Nil Cosméticos',
  // Dias da semana com expediente (0 = domingo). A loja não abre sábado nem domingo.
  dias_expediente: '1,2,3,4,5',
  // Ponto por etiqueta NFC (adendo do SPEC, seção 8). Desligado até a gestora gravar a etiqueta.
  ponto_exige_nfc: '0',
  // Entra no fim de todo prompt de imagem do roteiro, para as artes saírem com a mesma cara.
  estilo_marca:
    'Estilo Nil Cosméticos: foto clean e luminosa, fundo claro em tons de rosa e branco, luz suave, ' +
    'produto em destaque, sem pessoas, sem texto escrito na imagem, formato vertical 4:5.',
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
      { text: 'Bater ponto de entrada', points: 10, auto: 'check_in', due_time: '13:00' },
      { text: 'Abrir a loja: luzes, som, vitrine e balcão', points: 5, due_time: '13:05' },
      { text: 'Postar "Boa tarde" no Grupo VIP', points: 15, due_time: '13:15' },
      { text: 'Conferir caixa, troco e organização do balcão', points: 5, due_time: '13:20' },
    ],
  },
  {
    title: 'Salão',
    subtitle: null,
    tasks: [
      { text: 'Limpeza do foco do dia: {foco}', points: 20, requires_photo: true, due_time: '14:00' },
      { text: 'Reposição e organização de gôndolas (15 min)', points: 10, due_time: '15:00' },
    ],
  },
  {
    title: 'Conteúdo',
    subtitle: null,
    tasks: [
      // Cada postagem do roteiro do dia tem o próprio horário; os pontos se dividem entre elas.
      { text: 'Postagens do dia', points: 30, posts: true },
    ],
  },
  {
    title: 'Fechamento',
    subtitle: null,
    tasks: [
      { text: 'Limpeza final: hall e entrada', points: 20, requires_photo: true, due_time: '17:30' },
      { text: 'Fechamento de caixa e relatório do dia', points: 10, due_time: '17:45' },
      { text: 'Apoiar o fechamento da loja com a gestora', points: 10, due_time: '17:55' },
      { text: 'Bater ponto de saída', points: 10, auto: 'check_out', due_time: '18:00' },
      { text: 'Fechar o dia no app e enviar o resumo', points: 5, auto: 'close', due_time: '18:05' },
    ],
  },
];

export const POST_KINDS = {
  grupo_vip: 'Grupo VIP',
  stories: 'Stories/Status',
  feed: 'Feed',
  tiktok: 'TikTok/Reels',
  mensagem: 'Mensagem para clientes',
};

export const MAX_POSTS_PER_DAY = 10;

// Tema de cada dia útil do roteiro padrão (índice = dia da semana).
const DAY_THEMES = {
  1: { theme: 'cuidados com os cabelos', product: 'um kit de shampoo, condicionador e máscara capilar' },
  2: { theme: 'maquiagem do dia a dia', product: 'batons, base e paleta de sombras' },
  3: { theme: 'skincare', product: 'sérum facial, hidratante e protetor solar' },
  4: { theme: 'perfumaria', product: 'frascos de perfume e body splash' },
  5: { theme: 'ofertas do fim de semana', product: 'uma seleção dos produtos mais vendidos da loja' },
};

/** Roteiro inicial: três postagens por dia útil, com prompts prontos para o ChatGPT. */
export function defaultPosts() {
  const posts = [];
  for (const [weekday, { theme, product }] of Object.entries(DAY_THEMES)) {
    posts.push(
      {
        weekday: Number(weekday),
        time: '13:30',
        kind: 'grupo_vip',
        goal: `Boa tarde com a novidade do dia: ${theme}`,
        image_prompt: `Crie uma imagem de ${product} arrumados sobre um balcão de loja de cosméticos.`,
        text_prompt:
          `Escreva uma mensagem curta de WhatsApp para o grupo VIP de clientes da Nil Cosméticos, em Manaus, ` +
          `sobre ${theme}. Tom alegre e próximo, no máximo 4 linhas, até 2 emojis, terminando com um convite ` +
          `para passar na loja hoje.`,
      },
      {
        weekday: Number(weekday),
        time: '15:30',
        kind: 'stories',
        goal: `Dica rápida de ${theme}`,
        image_prompt: `Crie uma imagem em close de ${product}, com gotas ou texturas que mostrem o produto em uso.`,
        text_prompt:
          `Escreva o texto de um story de Instagram da Nil Cosméticos com uma dica rápida de ${theme}. ` +
          `Uma frase de gancho, uma dica prática e a chamada "Responda este story que a gente separa para você".`,
      },
      {
        weekday: Number(weekday),
        time: '17:00',
        kind: 'feed',
        goal: `Post do feed: ${theme}`,
        image_prompt: `Crie uma imagem de vitrine com ${product}, composição organizada e elegante.`,
        text_prompt:
          `Escreva uma legenda de Instagram para a Nil Cosméticos sobre ${theme}. Comece com uma pergunta ` +
          `que prenda a atenção, explique o benefício em 2 frases, termine com "Vem para a Nil" e sugira 5 hashtags.`,
      },
    );
  }
  return posts;
}
