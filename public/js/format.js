// Formatação de datas sempre no fuso da loja, independente do fuso do aparelho.
const TZ = 'America/Manaus';

const longDate = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
const hourMinute = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

/** "segunda-feira, 26 de outubro" a partir de "2026-10-26". */
export function formatDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return longDate.format(new Date(Date.UTC(y, m - 1, d)));
}

/** "13:02" a partir de um ISO gravado pelo servidor. */
export function formatTime(iso) {
  return iso ? hourMinute.format(new Date(iso)) : '';
}
