import { api } from '../api.js';
import { h, fill } from '../dom.js';
import { formatShortDate } from '../format.js';
import { header } from './layout.js';
import { columnChart, pieChart, outOfTen, CHART_COLORS } from '../charts.js';

const PERIODS = [
  { days: 7, label: '7 dias' },
  { days: 30, label: '30 dias' },
];

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "Minha evolução": os números da própria funcionária, em linguagem simples e com incentivo. */
export function progressView({ user, onLogout, nav }) {
  let days = 7;
  const firstName = user.name.split(' ')[0];
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Período' });
  const body = h('div', {}, h('p', { class: 'boot' }, 'Carregando…'));

  function cheer(d) {
    if (d.streak >= 2) return `${firstName}, você bateu a meta ${d.streak} dias seguidos! Continue assim.`;
    if (d.goal_days > 0) return `Você bateu a meta em ${plural(d.goal_days, 'dia', 'dias')} de ${d.worked_days}. Bora para o próximo!`;
    const best = d.best_day?.points ?? 0;
    return `Seu melhor dia teve ${best} pontos. Faltam ${Math.max(d.meta - best, 0)} para a meta de ${d.meta}. Você consegue!`;
  }

  function tierCard(d) {
    if (!d.tier) return null;
    const next = d.next_tier;
    const reached = d.tier.id !== 'abaixo';
    return h(
      'section',
      { class: 'card', 'aria-labelledby': 'tier-title' },
      h('h2', { id: 'tier-title' }, 'Sua faixa de bônus'),
      reached
        ? h('p', { class: 'adherence' }, h('span', { class: `tier tier-${d.tier.id}` }, `Faixa ${d.tier.label}`))
        : h('p', { class: 'muted' }, 'Você ainda não chegou a uma faixa neste período.'),
      next
        ? h('p', { class: 'chart-result' }, `Faltam ${next.missing_pct}% de aproveitamento para a faixa ${next.label}.`)
        : h('p', { class: 'chart-result' }, 'Você está na faixa mais alta. Arrasou!'),
      h('p', { class: 'muted' }, 'Aproveitamento é a soma dos seus pontos dividida pela meta de todos os dias trabalhados.'),
    );
  }

  function render(d) {
    if (!d.worked_days) {
      fill(body, h('section', { class: 'card' },
        h('h2', {}, 'Ainda sem dias fechados'),
        h('p', { class: 'muted' }, `Feche o dia em "Hoje" (botão "Fechar o dia") e sua evolução dos últimos ${days} dias aparece aqui.`)));
      return;
    }
    const tile = (label, value, hint) => h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, label), h('strong', { class: 'kpi-value' }, value), hint && h('span', { class: 'kpi-hint' }, hint));
    const p = d.punctuality;
    const tasksTen = outOfTen(d.tasks.done, d.tasks.total);
    fill(
      body,
      h(
        'section',
        { class: 'card', 'aria-labelledby': 'cheer-title' },
        h('h2', { id: 'cheer-title' }, 'Suas conquistas'),
        h('p', { class: 'goal-msg done' }, cheer(d)),
        h('div', { class: 'kpis' },
          tile('Dias na meta', String(d.goal_days), `de ${d.worked_days} trabalhados`),
          tile('Seguidos na meta', String(d.streak), d.streak === 1 ? 'dia' : 'dias'),
          tile('Melhor dia', `${d.best_day.points} pts`, formatShortDate(d.best_day.date)),
          tile('Média por dia', `${String(d.average_points).replace('.', ',')} pts`, `meta ${d.meta}`)),
      ),
      tierCard(d),
      h(
        'section',
        { class: 'card', 'aria-labelledby': 'my-days' },
        h('h2', { id: 'my-days' }, 'Seus pontos em cada dia'),
        h('p', { class: 'chart-sentence' }, `A linha tracejada é a meta de ${d.meta} pontos. Coluna rosa: você bateu a meta.`),
        columnChart({
          meta: d.meta,
          ariaLabel: `Seus pontos por dia. Meta batida em ${d.goal_days} de ${d.worked_days} dias.`,
          items: d.series.map((x) => ({
            label: d.series.length <= 7 ? `${formatShortDate(x.date).slice(0, 3)} ${x.date.slice(8)}` : x.date.slice(8),
            value: x.points,
            title: `${formatShortDate(x.date)}: ${x.points} pontos`,
          })),
        }),
      ),
      h(
        'section',
        { class: 'card', 'aria-labelledby': 'my-tasks' },
        h('h2', { id: 'my-tasks' }, 'Tarefas que você fez'),
        pieChart({
          ariaLabel: `Você fez ${d.tasks.done} de ${d.tasks.total} tarefas.`,
          parts: [
            { label: 'Feitas', value: d.tasks.done, color: CHART_COLORS.good },
            { label: 'Não feitas', value: d.tasks.total - d.tasks.done, color: CHART_COLORS.rest },
          ],
        }),
        tasksTen != null && h('p', { class: 'chart-result' }, `De cada 10 tarefas, você fez ${tasksTen}.`),
      ),
      p.timed > 0 && h(
        'section',
        { class: 'card', 'aria-labelledby': 'my-time' },
        h('h2', { id: 'my-time' }, 'No horário'),
        pieChart({
          ariaLabel: `${p.on_time} de ${p.timed} tarefas com horário feitas na hora.`,
          parts: [
            { label: 'No horário', value: p.on_time, color: CHART_COLORS.onTime },
            { label: 'Com atraso', value: p.timed - p.on_time, color: CHART_COLORS.late },
          ],
        }),
        h('p', { class: 'chart-result' }, `De cada 10 tarefas com horário, ${outOfTen(p.on_time, p.timed)} saíram na hora certa.`),
      ),
    );
  }

  function renderChips() {
    fill(chips, PERIODS.map((x) =>
      h('button', { type: 'button', class: 'chip', 'aria-pressed': String(x.days === days), onclick: () => { days = x.days; renderChips(); load(); } }, x.label)));
  }

  async function load() {
    fill(body, h('p', { class: 'boot' }, 'Carregando…'));
    try {
      render(await api.progress(days));
    } catch (err) {
      fill(body, h('section', { class: 'card' }, h('p', { class: 'alert alert-error', role: 'alert' }, err.message)));
    }
  }

  renderChips();
  load();
  return h(
    'div',
    {},
    header({
      title: 'Minha evolução',
      subtitle: `Oi, ${firstName}!`,
      actions: h('button', { class: 'btn btn-ghost', type: 'button', onclick: onLogout }, 'Sair'),
    }),
    nav,
    h('div', { class: 'container' }, h('section', { class: 'card' }, h('h2', {}, 'Período'), chips), body),
  );
}
