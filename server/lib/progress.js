// Números da tela "Minha evolução" da funcionária. Funções puras sobre o resumo do período.
import { BONUS_TIERS } from './points.js';
import { addDays, weekdayOf } from './date.js';

/**
 * Dias seguidos batendo a meta, contando para trás a partir do último dia encerrado.
 * Um dia de expediente sem registro no meio quebra a sequência.
 */
export function goalStreak(series, workdays, meta) {
  let streak = 0;
  let expected = null;
  for (const day of [...series].reverse()) {
    if (expected && day.date !== expected) break;
    if (day.points < meta) break;
    streak++;
    let prev = addDays(day.date, -1);
    while (!workdays.includes(weekdayOf(prev))) prev = addDays(prev, -1);
    expected = prev;
  }
  return streak;
}

/** Próxima faixa acima da atual e quantos pontos percentuais faltam (inteiros, arredondados para cima). */
export function nextTier(ratio) {
  if (ratio == null) return null;
  const pct = Math.floor(ratio * 100 + 1e-9);
  const above = [...BONUS_TIERS].reverse().find((t) => t.min * 100 > pct);
  return above ? { id: above.id, label: above.label, missing_pct: Math.round(above.min * 100) - pct } : null;
}

export function bestDay(series) {
  return series.reduce((best, d) => (!best || d.points > best.points ? d : best), null);
}
