// Funções puras de pontuação e adesão (brief, seção 7.1).
import { snapshotTasks } from './snapshot.js';

export const BONUS_TIERS = [
  { id: 'ouro', label: 'Ouro', min: 0.95, share: 1 },
  { id: 'prata', label: 'Prata', min: 0.88, share: 0.75 },
  { id: 'bronze', label: 'Bronze', min: 0.8, share: 0.5 },
  { id: 'abaixo', label: 'Abaixo', min: 0, share: 0 },
];

/** Pontos do dia a partir do snapshot e dos ids marcados. Ids que não estão no snapshot são ignorados. */
export function dayPoints(snapshot, checkedTaskIds) {
  const checked = new Set(checkedTaskIds);
  const tasks = snapshotTasks(snapshot);
  const doneTasks = tasks.filter((task) => checked.has(task.id));
  return {
    earned: doneTasks.reduce((sum, task) => sum + task.points, 0),
    max: tasks.reduce((sum, task) => sum + task.points, 0),
    done: doneTasks.length,
    total: tasks.length,
  };
}

/**
 * Adesão no período. `days` = [{ points, checks }]; só conta dia com pelo menos um check.
 * Devolve null quando não há dia trabalhado.
 */
export function adherence(days, meta) {
  const worked = days.filter((day) => day.checks > 0);
  if (worked.length === 0 || !(meta > 0)) return { ratio: null, workedDays: 0, totalPoints: 0 };
  const totalPoints = worked.reduce((sum, day) => sum + day.points, 0);
  return { ratio: totalPoints / (worked.length * meta), workedDays: worked.length, totalPoints };
}

// Faixas do brief em inteiros (88% a 94%, 80% a 87%): arredonda para o percentual inteiro antes de comparar.
export function bonusTier(ratio) {
  if (ratio == null) return null;
  const pct = Math.floor(ratio * 100 + 1e-9);
  return BONUS_TIERS.find((tier) => pct >= tier.min * 100);
}
