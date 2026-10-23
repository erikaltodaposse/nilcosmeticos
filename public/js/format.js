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

const shortDate = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit' });
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const percent = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });

/** "seg., 26/10" a partir de "2026-10-26". */
export function formatShortDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return shortDate.format(new Date(Date.UTC(y, m - 1, d)));
}

export const formatMoney = (value) => money.format(value);
export const formatPercent = (ratio) => percent.format(ratio);

/** Soma dias a "AAAA-MM-DD". */
export function addDays(key, days) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
