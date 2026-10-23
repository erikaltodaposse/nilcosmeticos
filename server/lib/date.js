// Único lugar que decide "que dia é hoje". Toda data de negócio é em America/Manaus.
export const TIME_ZONE = 'America/Manaus';

const DATE_KEY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD do instante informado, no fuso da loja. */
export function dateKey(date) {
  return DATE_KEY_FORMAT.format(date);
}

/** YYYY-MM-DD de hoje no fuso da loja. */
export function todayKey(now = new Date()) {
  return dateKey(now);
}

/** Instante atual em ISO 8601 UTC, para timestamps gravados pelo servidor. */
export function nowISO(now = new Date()) {
  return now.toISOString();
}

/** true se a string é uma data de calendário válida no formato YYYY-MM-DD. */
export function isDateKey(value) {
  if (typeof value !== 'string' || !DATE_KEY_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** Dia da semana (0 = domingo) de uma chave YYYY-MM-DD. */
export function weekdayOf(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
