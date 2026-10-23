import { api } from '../api.js';
import { h, showError } from '../dom.js';
import { formatDateKey, formatTime } from '../format.js';
import { header } from './layout.js';

const AUTO_LABEL = {
  check_in: 'Marcada ao registrar a entrada',
  check_out: 'Marcada ao registrar a saída',
  close: 'Marcada ao fechar o dia',
};

function progressRing(earned, meta) {
  const ratio = meta > 0 ? Math.min(earned / meta, 1) : 0;
  const r = 52;
  const c = 2 * Math.PI * r;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('class', 'ring');
  svg.setAttribute('aria-hidden', 'true');
  const track = document.createElementNS(ns, 'circle');
  const bar = document.createElementNS(ns, 'circle');
  for (const el of [track, bar]) {
    el.setAttribute('cx', '60');
    el.setAttribute('cy', '60');
    el.setAttribute('r', String(r));
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke-width', '12');
  }
  track.setAttribute('class', 'ring-track');
  bar.setAttribute('class', 'ring-bar');
  bar.setAttribute('stroke-dasharray', `${c * ratio} ${c}`);
  bar.setAttribute('transform', 'rotate(-90 60 60)');
  bar.setAttribute('stroke-linecap', 'round');
  svg.append(track, bar);
  return h(
    'div',
    { class: 'ring-wrap' },
    svg,
    h('div', { class: 'ring-label' }, h('strong', {}, String(earned)), h('span', {}, `de ${meta}`)),
  );
}

export function todayView({ date, onLogout }) {
  let state = null;
  const openPosts = new Set();
  let pending = false;

  const error = h('p', { class: 'alert alert-error', role: 'alert', hidden: true });
  const body = h('div', { class: 'container' }, h('p', { class: 'boot' }, 'Carregando o dia…'));
  const root = h(
    'div',
    {},
    header({
      title: 'Hoje',
      subtitle: formatDateKey(date),
      actions: h('button', { class: 'btn btn-ghost', type: 'button', onclick: onLogout }, 'Sair'),
    }),
    body,
  );

  async function act(fn, focusId) {
    if (pending) return;
    pending = true;
    showError(error, '');
    try {
      state = await fn();
      render(focusId);
    } catch (err) {
      showError(error, err.message);
      error.scrollIntoView({ block: 'nearest' });
    } finally {
      pending = false;
    }
  }

  function shiftCard() {
    const { day, settings, editable } = state;
    const p = day.points;
    let action = null;
    if (editable && !day.check_in_at) {
      action = h('button', { class: 'btn', type: 'button', onclick: () => act(() => api.checkIn(date)) }, 'Registrar entrada');
    } else if (editable && !day.check_out_at) {
      action = h(
        'button',
        { class: 'btn btn-outline', type: 'button', onclick: () => act(() => api.checkOut(date)) },
        'Registrar saída',
      );
    }
    return h(
      'section',
      { class: 'card summary', 'aria-label': 'Resumo do dia' },
      h(
        'div',
        { class: 'summary-top' },
        progressRing(p.earned, p.meta),
        h(
          'div',
          { class: 'summary-text' },
          h('p', { class: 'big' }, `${p.earned} de ${p.meta} pontos`),
          h('p', { class: 'muted' }, `${p.done} de ${p.total} tarefas`),
          h('p', { class: 'muted' }, `Turno das ${settings.turno_inicio} às ${settings.turno_fim}`),
        ),
      ),
      h(
        'dl',
        { class: 'times' },
        h('div', {}, h('dt', {}, 'Entrada'), h('dd', {}, day.check_in_at ? formatTime(day.check_in_at) : 'Não registrada')),
        h('div', {}, h('dt', {}, 'Saída'), h('dd', {}, day.check_out_at ? formatTime(day.check_out_at) : 'Não registrada')),
      ),
      day.late_checkout &&
        h('p', { class: 'flag' }, `Saída registrada depois de ${settings.turno_fim} com mais de 10 minutos de tolerância.`),
      action,
    );
  }

  function postPanel(slot) {
    const post = state.posts.find((p) => p.slot === slot);
    if (!post) {
      return h('div', { class: 'post-panel' }, h('p', { class: 'muted' }, 'O roteiro deste horário ainda não foi cadastrado pela gestora. Siga a linha de produto do dia.'));
    }
    const text = [post.hook, post.caption, post.cta].filter(Boolean).join('\n\n');
    const copied = h('span', { class: 'copied', role: 'status' });
    return h(
      'div',
      { class: 'post-panel' },
      post.hook && h('p', {}, h('strong', {}, 'Gancho: '), post.hook),
      post.caption && h('p', { class: 'caption' }, post.caption),
      post.cta && h('p', {}, h('strong', {}, 'Chamada: '), post.cta),
      h(
        'button',
        {
          class: 'btn btn-small',
          type: 'button',
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(text);
              copied.textContent = 'Texto copiado.';
            } catch {
              copied.textContent = 'Não deu para copiar. Selecione o texto e copie manualmente.';
            }
          },
        },
        'Copiar',
      ),
      copied,
    );
  }

  function taskRow(task) {
    const { editable, date: d } = state;
    const id = `task-${task.id}`;
    const clickable = editable && !task.auto;
    const toggle = () =>
      act(() => (task.done ? api.unmarkTask(d, task.id) : api.markTask(d, task.id)), id);
    const meta = [
      h('span', { class: 'pts' }, `+${task.points}`),
      task.requires_photo && h('span', { class: 'tag' }, 'Exige foto'),
      task.auto && h('span', { class: 'tag tag-soft' }, AUTO_LABEL[task.auto]),
      task.done && task.done_at && h('span', { class: 'when' }, `às ${formatTime(task.done_at)}`),
    ];
    const check = h(
      'button',
      {
        id,
        type: 'button',
        class: `task${task.done ? ' done' : ''}`,
        role: 'checkbox',
        'aria-checked': String(task.done),
        'aria-disabled': clickable ? false : 'true',
        onclick: clickable ? toggle : null,
      },
      h('span', { class: 'box', 'aria-hidden': 'true' }),
      h('span', { class: 'task-body' }, h('span', { class: 'task-text' }, task.text), h('span', { class: 'task-meta' }, meta)),
    );
    let roteiro = null;
    if (task.post_slot) {
      const isOpen = openPosts.has(task.post_slot);
      roteiro = [
        h(
          'button',
          {
            type: 'button',
            class: 'link-btn',
            'aria-expanded': String(isOpen),
            onclick: () => {
              if (isOpen) openPosts.delete(task.post_slot);
              else openPosts.add(task.post_slot);
              render(`roteiro-${task.post_slot}`);
            },
            id: `roteiro-${task.post_slot}`,
          },
          isOpen ? 'Esconder roteiro' : 'Ver roteiro',
        ),
        isOpen && postPanel(task.post_slot),
      ];
    }
    return h('li', { class: 'task-item' }, check, roteiro);
  }

  function closeCard() {
    const { day, editable } = state;
    if (day.closed_at) {
      return h(
        'section',
        { class: 'card' },
        h('h2', {}, 'Dia fechado'),
        h('p', { class: 'muted' }, `Fechado às ${formatTime(day.closed_at)} com ${day.points.earned} de ${day.points.meta} pontos. Bom descanso.`),
      );
    }
    if (!editable) return null;
    const ready = Boolean(day.check_out_at);
    return h(
      'section',
      { class: 'card' },
      h('h2', {}, 'Fechar o dia'),
      h(
        'p',
        { class: 'muted' },
        ready
          ? 'Confira as tarefas acima. Depois de fechado, o dia não pode mais ser alterado.'
          : 'Registre a saída para poder fechar o dia.',
      ),
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          disabled: !ready,
          onclick: () => {
            if (window.confirm('Fechar o dia agora? Depois disso não dá para alterar as tarefas.')) {
              act(() => api.closeDay(date));
            }
          },
        },
        'Fechar o dia',
      ),
    );
  }

  function render(focusId) {
    if (!state.workday) {
      body.replaceChildren(
        h(
          'section',
          { class: 'card' },
          h('h2', {}, 'Sem expediente hoje'),
          h('p', { class: 'muted' }, 'A loja abre de segunda a sexta. Seu checklist volta no próximo dia útil.'),
        ),
      );
      return;
    }
    const { day } = state;
    body.replaceChildren(
      error,
      shiftCard(),
      h('p', { class: 'notice rule' }, h('strong', {}, 'A loja nunca fica sozinha. '), 'Se o fechamento passar das 18h, você permanece até a loja fechar com a gestora.'),
      ...day.sections.map((section, i) =>
        h(
          'section',
          { class: 'card', 'aria-labelledby': `sec-${i}` },
          h('h2', { id: `sec-${i}` }, section.title),
          section.subtitle && h('p', { class: 'muted' }, section.subtitle),
          h('ul', { class: 'tasks' }, section.tasks.map(taskRow)),
        ),
      ),
      closeCard(),
    );
    if (focusId) document.getElementById(focusId)?.focus();
  }

  api
    .day(date)
    .then((data) => {
      state = data;
      render();
    })
    .catch((err) => {
      body.replaceChildren(h('section', { class: 'card' }, h('p', { class: 'alert alert-error', role: 'alert' }, err.message)));
    });

  return root;
}
