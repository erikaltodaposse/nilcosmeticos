import { api } from '../api.js';
import { h, fill } from '../dom.js';
import { addDays, formatShortDate, formatTime, formatMoney, formatPercent } from '../format.js';
import { dayDetail } from './day-detail.js';
import { columnChart, pieChart, outOfTen, CHART_COLORS } from '../charts.js';

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
  const charts = h('div', {});
  const failures = h('section', { class: 'card', 'aria-labelledby': 'fail-title' });
  const history = h('section', { class: 'card', 'aria-labelledby': 'hist-title' });
  const exportCard = h('section', { class: 'card', 'aria-labelledby': 'export-title' });
  const main = h('div', {}, live, h('section', { class: 'card' }, h('h2', {}, 'Período'), periodChips), kpis, charts, failures, history, exportCard);
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
        tile('No horário', s.punctuality?.ratio == null ? '–' : formatPercent(s.punctuality.ratio),
          s.punctuality?.timed ? `${s.punctuality.on_time} de ${s.punctuality.timed} com horário` : 'tarefas com horário'),
        tile('Saídas após tolerância', String(s.late_checkouts)),
        tile('Não fechados no app', String(s.not_closed)),
        tile('Pontos no período', String(s.total_points)),
      ),
    );
  }

  function renderCharts(data) {
    const s = data.summary;
    if (!s.worked_days) {
      fill(charts);
      return;
    }
    const hits = s.series.filter((d) => d.points >= data.meta).length;
    const days = s.series.slice(-31);
    const tasksTen = outOfTen(s.tasks.done, s.tasks.total);
    const p = s.punctuality;
    const onTimeTen = outOfTen(p.on_time, p.timed);
    const sentence = (text) => h('p', { class: 'chart-sentence' }, text);
    fill(
      charts,
      h(
        'section',
        { class: 'card', 'aria-labelledby': 'chart-days' },
        h('h2', { id: 'chart-days' }, 'Pontos em cada dia'),
        sentence(`A linha tracejada é a meta de ${data.meta} pontos. Coluna rosa: bateu a meta. Coluna cinza: ficou abaixo.`),
        columnChart({
          meta: data.meta,
          ariaLabel: `Pontos por dia. Bateu a meta em ${hits} de ${s.series.length} dias.`,
          items: days.map((d) => ({
            label: days.length <= 7 ? `${formatShortDate(d.date).slice(0, 3)} ${d.date.slice(8)}` : d.date.slice(8),
            value: d.points,
            title: `${formatShortDate(d.date)}: ${d.points} pontos`,
          })),
        }),
        h('p', { class: 'chart-result' }, `Bateu a meta em ${hits} de ${s.series.length} ${s.series.length === 1 ? 'dia' : 'dias'}.`),
      ),
      h(
        'section',
        { class: 'card', 'aria-labelledby': 'chart-tasks' },
        h('h2', { id: 'chart-tasks' }, 'Tarefas feitas'),
        pieChart({
          ariaLabel: `Tarefas: ${s.tasks.done} feitas e ${s.tasks.total - s.tasks.done} não feitas.`,
          parts: [
            { label: 'Feitas', value: s.tasks.done, color: CHART_COLORS.good },
            { label: 'Não feitas', value: s.tasks.total - s.tasks.done, color: CHART_COLORS.rest },
          ],
        }),
        tasksTen != null && h('p', { class: 'chart-result' }, `De cada 10 tarefas, ela fez ${tasksTen}.`),
      ),
      p.timed > 0 && h(
        'section',
        { class: 'card', 'aria-labelledby': 'chart-time' },
        h('h2', { id: 'chart-time' }, 'Feitas no horário'),
        pieChart({
          ariaLabel: `Tarefas com horário: ${p.on_time} no horário e ${p.timed - p.on_time} com atraso.`,
          parts: [
            { label: 'No horário', value: p.on_time, color: CHART_COLORS.onTime },
            { label: 'Com atraso', value: p.timed - p.on_time, color: CHART_COLORS.late },
          ],
        }),
        h('p', { class: 'chart-result' }, `De cada 10 tarefas com horário, ${onTimeTen} saíram na hora certa.`),
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

  function renderExport() {
    const p = PERIODS.find((x) => x.id === period);
    fill(
      exportCard,
      h('h2', { id: 'export-title' }, 'Exportar'),
      h('p', { class: 'muted' }, `Planilha com um dia por linha (${p.days ? `últimos ${p.days} dias` : 'todo o histórico'}). Abre direto no Excel.`),
      h('a', { class: 'btn btn-outline', href: `/api/manager/export.csv?${query()}`, download: '' }, 'Baixar planilha (CSV)'),
      h('p', { class: 'muted mt' }, 'Backup completo dos registros, tarefas, ajustes e roteiro. Guarde em lugar seguro: as fotos são copiadas à parte pelo backup do servidor.'),
      h('a', { class: 'btn btn-outline', href: '/api/manager/backup.json', download: '' }, 'Baixar backup (JSON)'),
    );
  }

  async function loadPeriod() {
    renderExport();
    const q = query();
    for (const el of [kpis, failures, history]) fill(el, h('p', { class: 'boot' }, 'Carregando…'));
    try {
      const [summary, fails, days] = await Promise.all([api.summary(q), api.failures(q), api.days(q)]);
      renderKpis(summary);
      renderCharts(summary);
      renderFailures(fails);
      renderHistory(days);
    } catch (err) {
      fill(kpis, h('p', { class: 'alert alert-error', role: 'alert' }, err.message));
      fill(charts);
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
