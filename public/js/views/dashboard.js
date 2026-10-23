import { api } from '../api.js';
import { h, fill } from '../dom.js';
import { addDays, formatShortDate, formatTime, formatMoney, formatPercent } from '../format.js';
import { dayDetail } from './day-detail.js';

const PERIODS = [
  { id: '7', label: '7 dias', days: 7 },
  { id: '30', label: '30 dias', days: 30 },
  { id: 'all', label: 'Tudo', days: null },
];

const STATUS = {
  fechado: 'Fechado',
  em_andamento: 'Em andamento',
  sem_fechamento: 'Não fechado no app',
  sem_registro: 'Aberto sem registro',
};

const LIVE_INTERVAL_MS = 5000;

function bar(points, meta) {
  const pct = meta > 0 ? Math.min(100, Math.round((points / meta) * 100)) : 0;
  return h('span', { class: 'bar', 'aria-hidden': 'true' }, h('span', { class: 'bar-fill', style: `width:${pct}%` }));
}

export function dashboardView({ today }) {
  let period = '7';
  let employeeId = null;
  let liveTimer = null;

  const root = h('div', {});
  const periodChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Período' });
  const live = h('section', { class: 'card live', 'aria-live': 'polite', 'aria-labelledby': 'live-title' });
  const kpis = h('section', { class: 'card', 'aria-labelledby': 'kpi-title' });
  const failures = h('section', { class: 'card', 'aria-labelledby': 'fail-title' });
  const history = h('section', { class: 'card', 'aria-labelledby': 'hist-title' });
  const main = h('div', {}, live, h('section', { class: 'card' }, h('h2', {}, 'Período'), periodChips), kpis, failures, history);
  root.append(main);

  function query() {
    const p = PERIODS.find((x) => x.id === period);
    const params = new URLSearchParams({ to: today });
    if (p.days) params.set('from', addDays(today, -(p.days - 1)));
    return params.toString();
  }

  function openDay(date) {
    stopLive();
    window.scrollTo(0, 0);
    root.replaceChildren(
      dayDetail({
        date,
        userId: employeeId,
        onBack: () => {
          root.replaceChildren(main);
          startLive();
          loadPeriod();
        },
      }),
    );
  }

  // Cartão "Hoje": relido a cada 5 s enquanto o painel está visível.
  async function loadLive() {
    try {
      const data = await api.dayOf(today);
      employeeId = data.employee?.id ?? null;
      const day = data.day;
      const name = data.employee?.name ?? 'Funcionária';
      if (!data.workday) {
        fill(live, h('h2', { id: 'live-title' }, 'Hoje'), h('p', { class: 'muted' }, 'Hoje não há expediente.'));
        return;
      }
      if (!day || (!day.check_in_at && day.points.done === 0)) {
        fill(live, h('h2', { id: 'live-title' }, 'Hoje'), h('p', { class: 'muted' }, `${name} ainda não registrou a entrada.`));
        return;
      }
      fill(
        live,
        h('h2', { id: 'live-title' }, `Hoje · ${name}`),
        h('p', { class: 'big' }, `${day.points.earned} de ${day.points.meta} pontos`),
        bar(day.points.earned, day.points.meta),
        h('p', { class: 'muted' },
          `Entrada ${day.check_in_at ? formatTime(day.check_in_at) : 'não registrada'} · ` +
          `Saída ${day.check_out_at ? formatTime(day.check_out_at) : 'não registrada'} · ` +
          `${day.closed_at ? 'dia fechado' : `${day.points.done} de ${day.points.total} tarefas`}`),
        day.late_checkout && h('p', { class: 'flag' }, 'Saída depois da tolerância de 10 minutos.'),
        h('button', { type: 'button', class: 'btn btn-outline mt', onclick: () => openDay(today) }, 'Ver o dia de hoje'),
      );
    } catch (err) {
      fill(live, h('p', { class: 'alert alert-error', role: 'alert' }, err.message));
    }
  }

  function startLive() {
    stopLive();
    liveTimer = setInterval(() => {
      if (!root.isConnected) return stopLive();
      if (document.visibilityState === 'visible') loadLive();
    }, LIVE_INTERVAL_MS);
  }

  function stopLive() {
    if (liveTimer) clearInterval(liveTimer);
    liveTimer = null;
  }

  function renderKpis(data) {
    const s = data.summary;
    const title = h('h2', { id: 'kpi-title' }, 'Adesão');
    if (!s.worked_days) {
      fill(kpis, title, h('p', { class: 'muted' }, 'Ainda não há dias encerrados neste período. Os números aparecem quando a funcionária fechar o primeiro dia.'),
        s.missing_workdays > 0 && h('p', { class: 'flag' }, `${s.missing_workdays} dia(s) de expediente sem nenhum registro.`));
      return;
    }
    const tile = (label, value, hint) => h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, label), h('strong', { class: 'kpi-value' }, value), hint && h('span', { class: 'kpi-hint' }, hint));
    fill(
      kpis,
      title,
      h('div', { class: 'adherence' },
        h('strong', { class: 'adherence-value' }, formatPercent(s.adherence)),
        h('span', { class: `tier tier-${s.tier.id}` }, `Faixa ${s.tier.label}`)),
      h('p', { class: 'muted' },
        data.bonus_base > 0
          ? `Bônus estimado: ${formatMoney(s.bonus_value)} (${Math.round(s.tier.share * 100)}% de ${formatMoney(data.bonus_base)}).`
          : 'Bônus-base não configurado. Defina em Ajustes para ver o valor estimado.'),
      h('div', { class: 'kpis' },
        tile('Dias trabalhados', String(s.worked_days)),
        tile('Média por dia', `${String(s.average_points).replace('.', ',')} pts`, `meta ${data.meta}`),
        tile('Sem registro', String(s.missing_workdays), 'dias de expediente'),
        tile('Saídas após tolerância', String(s.late_checkouts)),
        tile('Não fechados no app', String(s.not_closed)),
        tile('Pontos no período', String(s.total_points)),
      ),
    );
  }

  function renderFailures(data) {
    const title = h('h2', { id: 'fail-title' }, 'Tarefas que mais falham');
    if (!data.failures.length) {
      fill(failures, title, h('p', { class: 'muted' }, 'Nenhuma tarefa deixou de ser cumprida nos dias encerrados deste período.'));
      return;
    }
    fill(
      failures,
      title,
      h('ol', { class: 'ranking' }, data.failures.slice(0, 10).map((f) =>
        h('li', {},
          h('span', { class: 'rank-text' }, f.task, h('span', { class: 'muted rank-sec' }, ` · ${f.section}`)),
          h('span', { class: 'rank-count' }, `faltou em ${f.missed} de ${f.offered} dias`),
          bar(f.missed, f.offered)),
      )),
    );
  }

  function renderHistory(data) {
    const title = h('h2', { id: 'hist-title' }, 'Histórico');
    if (!data.days.length) {
      fill(history, title, h('p', { class: 'muted' }, 'Nenhum dia registrado neste período. Quando a funcionária abrir o app num dia de expediente, ele aparece aqui.'));
      return;
    }
    fill(
      history,
      title,
      h('ul', { class: 'history' }, data.days.map((d) =>
        h('li', {},
          h('button', { type: 'button', class: 'history-row', onclick: () => openDay(d.date), 'aria-label': `Abrir ${formatShortDate(d.date)}: ${d.points} de ${data.meta} pontos, ${STATUS[d.status]}` },
            h('span', { class: 'history-top' },
              h('strong', {}, formatShortDate(d.date)),
              h('span', {}, `${d.points} de ${data.meta}`)),
            bar(d.points, data.meta),
            h('span', { class: 'history-meta' },
              STATUS[d.status],
              d.check_in_at && ` · ${formatTime(d.check_in_at)}–${d.check_out_at ? formatTime(d.check_out_at) : '?'}`,
              ` · fotos ${d.photos}/${d.photo_tasks}`,
              d.late_checkout && ' · saída tardia')),
        ),
      )),
    );
  }

  function renderChips() {
    fill(periodChips, PERIODS.map((p) =>
      h('button', { type: 'button', class: 'chip', 'aria-pressed': String(p.id === period), onclick: () => { period = p.id; renderChips(); loadPeriod(); } }, p.label),
    ));
  }

  async function loadPeriod() {
    const q = query();
    for (const el of [kpis, failures, history]) fill(el, h('p', { class: 'boot' }, 'Carregando…'));
    try {
      const [summary, fails, days] = await Promise.all([api.summary(q), api.failures(q), api.days(q)]);
      renderKpis(summary);
      renderFailures(fails);
      renderHistory(days);
    } catch (err) {
      fill(kpis, h('p', { class: 'alert alert-error', role: 'alert' }, err.message));
      fill(failures);
      fill(history);
    }
  }

  renderChips();
  loadLive();
  loadPeriod();
  startLive();
  return root;
}
