import { api } from '../api.js';
import { h, fill, showError } from '../dom.js';
import { formatDateKey, formatTime } from '../format.js';
import { header } from './layout.js';
import { POST_KINDS } from '../weekdays.js';
import { compressPhoto } from '../photo.js';

const AUTO_LABEL = {
  check_in: 'Marcada ao registrar a entrada',
  check_out: 'Marcada ao registrar a saída',
  close: 'Marcada ao fechar o dia',
};

const LATE_TOLERANCE_MIN = 15;
const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Ainda não feita e já passou do horário + tolerância. */
function isOverdue(due, done, nowTime) {
  return Boolean(due && !done && nowTime && minutes(nowTime) > minutes(due) + LATE_TOLERANCE_MIN);
}

/** Tarefas com horário em ordem de horário; as sem horário ficam onde estão. */
function byDueTime(tasks) {
  const timed = tasks.filter((t) => t.due_time).sort((a, b) => a.due_time.localeCompare(b.due_time));
  return tasks.map((t) => (t.due_time ? timed.shift() : t));
}

function chatGptUrl(prompt) {
  return `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`;
}

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
  bar.setAttribute('stroke', 'url(#ring-grad)');
  const defs = document.createElementNS(ns, 'defs');
  const grad = document.createElementNS(ns, 'linearGradient');
  grad.setAttribute('id', 'ring-grad');
  grad.setAttribute('x1', '0');
  grad.setAttribute('y1', '0');
  grad.setAttribute('x2', '1');
  grad.setAttribute('y2', '1');
  for (const [offset, color] of [['0', '#F49BB8'], ['0.5', '#E0307A'], ['1', '#930338']]) {
    const stop = document.createElementNS(ns, 'stop');
    stop.setAttribute('offset', offset);
    stop.setAttribute('stop-color', color);
    grad.append(stop);
  }
  defs.append(grad);
  svg.append(defs);
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

export function todayView({ user, date, nfcToken, onLogout }) {
  let state = null;
  let pending = false;
  let closing = false;
  let nfcCheckout = null; // código lido da etiqueta, aguardando confirmação da saída
  let photoTaskId = null;
  const status = h('p', { class: 'status', role: 'status' });

  // Um único seletor de arquivo para todas as tarefas com foto; abre a câmera traseira no celular.
  const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png', capture: 'environment', class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file || photoTaskId == null) return;
    const taskId = photoTaskId;
    status.textContent = 'Enviando foto…';
    await act(async () => {
      const blob = await compressPhoto(file);
      return api.uploadPhoto(date, taskId, blob);
    }, `task-${taskId}`);
    status.textContent = '';
  });

  function pickPhoto(taskId) {
    photoTaskId = taskId;
    fileInput.click();
  }

  const error = h('p', { class: 'alert alert-error', role: 'alert', hidden: true });
  const body = h('div', { class: 'container' }, h('p', { class: 'boot' }, 'Carregando o dia…'));
  const root = h(
    'div',
    {},
    header({
      title: 'Hoje',
      subtitle: `Oi, ${user.name.split(' ')[0]}! ${formatDateKey(date).replace(/^./, (c) => c.toUpperCase())}`,
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
    const tapHint = (what) => h('p', { class: 'notice nfc-hint' }, h('strong', {}, 'Ponto pela etiqueta. '), `Encoste o celular na etiqueta da loja para registrar a ${what}.`);
    if (editable && nfcCheckout && day.check_in_at && !day.check_out_at) {
      action = h(
        'div',
        { class: 'nfc-confirm', role: 'group', 'aria-labelledby': 'nfc-q' },
        h('p', { id: 'nfc-q', class: 'big', tabindex: '-1' }, 'Etiqueta lida. Registrar a saída agora?'),
        h('button', { class: 'btn', type: 'button', onclick: () => { const t = nfcCheckout; nfcCheckout = null; act(() => api.checkOut(date, t)); } }, 'Sim, registrar saída'),
        h('button', { class: 'btn btn-outline mt', type: 'button', onclick: () => { nfcCheckout = null; render(); } }, 'Agora não'),
      );
    } else if (editable && !day.check_in_at) {
      action = settings.nfc_required
        ? tapHint('entrada')
        : h('button', { class: 'btn', type: 'button', onclick: () => act(() => api.checkIn(date)) }, 'Registrar entrada');
    } else if (editable && !day.check_out_at) {
      action = settings.nfc_required
        ? tapHint('saída')
        : h('button', { class: 'btn btn-outline', type: 'button', onclick: () => act(() => api.checkOut(date)) }, 'Registrar saída');
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
      goalMessage(p, Boolean(day.closed_at)),
      action && h('div', { class: 'mt' }, action),
    );
  }

  function goalMessage(p, closed) {
    const left = p.meta - p.earned;
    if (left <= 0) {
      return h('p', { class: 'goal-msg done', role: 'status' }, h('span', { class: 'script' }, 'Meta batida!'),
        closed ? 'Arrasou hoje. Bom descanso.' : 'Arrasou hoje. Agora é só fechar o dia.');
    }
    if (closed) return h('p', { class: 'goal-msg' }, `Dia fechado com ${p.earned} pontos. Amanhã tem mais.`);
    if (p.earned === 0) return h('p', { class: 'goal-msg' }, `Bora começar? A meta é ${p.meta} pontos.`);
    return h('p', { class: 'goal-msg' }, `Faltam ${left} pontos para a meta.`);
  }

  async function copyText(text, out) {
    try {
      await navigator.clipboard.writeText(text);
      out.textContent = 'Copiado.';
    } catch {
      out.textContent = 'Não deu para copiar. Abra o texto e copie manualmente.';
    }
  }

  function promptBlock(label, prompt) {
    if (!prompt) return null;
    const copied = h('span', { class: 'copied', role: 'status' });
    return h(
      'div',
      { class: 'prompt' },
      h('details', {}, h('summary', {}, label), h('pre', { class: 'prompt-text' }, prompt)),
      h(
        'div',
        { class: 'prompt-actions' },
        h('button', { type: 'button', class: 'btn btn-small', onclick: () => copyText(prompt, copied) }, 'Copiar'),
        h('a', { class: 'btn btn-small btn-outline', href: chatGptUrl(prompt), target: '_blank', rel: 'noopener' }, 'Abrir no ChatGPT'),
      ),
      copied,
    );
  }

  function postCard(post) {
    const { editable, date: d, now_time: nowTime } = state;
    const id = `post-${post.id}`;
    const overdue = editable && isOverdue(post.time, post.done, nowTime);
    return h(
      'li',
      { class: `post-card${post.done ? ' done' : ''}` },
      h(
        'div',
        { class: 'post-head' },
        h('span', { class: 'tag tag-time' }, post.time),
        h('span', { class: 'post-kind' }, POST_KINDS[post.kind] ?? post.kind),
        overdue && h('span', { class: 'tag tag-late' }, 'Atrasada'),
        post.done && post.late && h('span', { class: 'tag tag-late' }, 'Feita com atraso'),
      ),
      post.goal && h('p', { class: 'post-goal' }, post.goal),
      promptBlock('Prompt da imagem', post.image_prompt_full),
      promptBlock('Prompt do texto', post.text_prompt),
      post.done
        ? h(
            'p',
            { class: 'post-done' },
            `Postada às ${formatTime(post.done_at)}. `,
            editable && h('button', { id, type: 'button', class: 'link-btn', onclick: () => act(() => api.unmarkPost(d, post.id), id) }, 'Desfazer'),
          )
        : editable && h('button', { id, type: 'button', class: 'btn btn-small', onclick: () => act(() => api.markPost(d, post.id), id) }, 'Marcar como postada'),
    );
  }

  function taskRow(task) {
    const { editable, date: d } = state;
    const id = `task-${task.id}`;
    const postsDriven = Boolean(task.posts?.length);
    const clickable = editable && !task.auto && !postsDriven;
    const overdue = editable && isOverdue(task.due_time, task.done, state.now_time);
    const toggle = () => {
      if (!task.done && task.requires_photo) return pickPhoto(task.id);
      if (task.done && task.has_photo && !window.confirm('Desmarcar esta tarefa apaga a foto enviada. Continuar?')) return;
      act(() => (task.done ? api.unmarkTask(d, task.id) : api.markTask(d, task.id)), id);
    };
    const meta = [
      h('span', { class: 'pts' }, `+${task.points}`),
      task.due_time && h('span', { class: 'tag tag-time' }, task.due_time),
      overdue && h('span', { class: 'tag tag-late' }, 'Atrasada'),
      task.done && task.late && h('span', { class: 'tag tag-late' }, 'Feita com atraso'),
      postsDriven && h('span', { class: 'tag tag-soft' }, `${task.posts.filter((p) => p.done).length} de ${task.posts.length} postagens`),
      task.requires_photo && !task.done && h('span', { class: 'tag' }, clickable ? 'Toque para tirar a foto' : 'Exige foto'),
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
    let photo = null;
    if (task.has_photo) {
      const src = api.photoUrl(d, task.id, task.done_at);
      photo = h(
        'div',
        { class: 'photo-row' },
        h('a', { href: src, target: '_blank', rel: 'noopener', class: 'thumb-link', 'aria-label': `Ampliar foto: ${task.text}` },
          h('img', { src, alt: `Foto: ${task.text}`, class: 'thumb', loading: 'lazy', width: '64', height: '64' })),
        clickable && h('button', { type: 'button', class: 'link-btn', onclick: () => pickPhoto(task.id) }, 'Trocar foto'),
      );
    }
    const roteiro = postsDriven && h('ol', { class: 'post-list', 'aria-label': 'Postagens do dia' }, task.posts.map(postCard));
    return h('li', { class: 'task-item' }, check, photo, roteiro);
  }

  function closeCard() {
    const { day, editable, summary } = state;
    if (day.closed_at) {
      const copied = h('span', { class: 'copied', role: 'status' });
      return h(
        'section',
        { class: 'card', 'aria-labelledby': 'closed-title' },
        h('h2', { id: 'closed-title' }, 'Dia fechado'),
        h('p', { class: 'muted' }, `Fechado às ${formatTime(day.closed_at)}. Envie o resumo para a gestora.`),
        h('pre', { class: 'summary-text-box' }, summary.text),
        h('a', { class: 'btn', href: summary.whatsapp_url, target: '_blank', rel: 'noopener' }, 'Enviar resumo no WhatsApp'),
        h(
          'button',
          {
            class: 'btn btn-outline mt',
            type: 'button',
            onclick: async () => {
              try {
                await navigator.clipboard.writeText(summary.text);
                copied.textContent = 'Resumo copiado.';
              } catch {
                copied.textContent = 'Não deu para copiar. Selecione o texto acima e copie manualmente.';
              }
            },
          },
          'Copiar resumo',
        ),
        copied,
      );
    }
    if (!editable) return null;
    const ready = Boolean(day.check_out_at);
    if (closing && ready) {
      const tasks = day.sections.flatMap((s) => s.tasks);
      const pendingTasks = tasks.filter((t) => !t.done && t.auto !== 'close');
      const closeTask = tasks.find((t) => t.auto === 'close');
      const projected = day.points.earned + (closeTask && !closeTask.done ? closeTask.points : 0);
      return h(
        'section',
        { class: 'card', 'aria-labelledby': 'close-title' },
        h('h2', { id: 'close-title', tabindex: '-1' }, 'Conferir antes de fechar'),
        h('p', { class: 'big' }, `${projected} de ${day.points.meta} pontos ao fechar`),
        pendingTasks.length
          ? [
              h('p', { class: 'muted' }, 'Ainda não cumpridas (não somam pontos):'),
              h('ul', { class: 'pending-list' }, pendingTasks.map((t) => h('li', {}, t.text))),
            ]
          : h('p', { class: 'muted' }, 'Todas as tarefas cumpridas.'),
        h('p', { class: 'muted' }, 'Depois de fechado, o dia não pode mais ser alterado.'),
        h('button', { class: 'btn', type: 'button', onclick: () => act(() => api.closeDay(date), 'closed-title') }, 'Confirmar e fechar o dia'),
        h('button', { class: 'btn btn-outline mt', type: 'button', onclick: () => { closing = false; render(); } }, 'Voltar'),
      );
    }
    return h(
      'section',
      { class: 'card' },
      h('h2', {}, 'Fechar o dia'),
      h(
        'p',
        { class: 'muted' },
        ready ? 'Confira o que ficou pendente e envie o resumo para a gestora.' : 'Registre a saída para poder fechar o dia.',
      ),
      h(
        'button',
        { class: 'btn', type: 'button', disabled: !ready, onclick: () => { closing = true; render('close-title'); } },
        'Fechar o dia',
      ),
    );
  }

  // Chegou pelo link da etiqueta: entrada vai direto; saída pede confirmação.
  async function handleNfc() {
    if (!nfcToken) return;
    const token = nfcToken;
    nfcToken = null;
    const { day, editable } = state;
    if (!editable) {
      status.textContent = state.workday ? 'Etiqueta lida, mas o dia já foi fechado.' : 'Etiqueta lida. Hoje não há expediente.';
      return;
    }
    if (!day.check_in_at) {
      await act(() => api.checkIn(date, token));
      if (state.day.check_in_at) status.textContent = `Entrada registrada pela etiqueta às ${formatTime(state.day.check_in_at)}.`;
    } else if (!day.check_out_at) {
      nfcCheckout = token;
      render('nfc-q');
    } else {
      status.textContent = 'Etiqueta lida. Entrada e saída de hoje já estão registradas.';
    }
  }

  function render(focusId) {
    if (!state.workday) {
      body.replaceChildren(
        status,
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
    fill(
      body,
      error,
      status,
      fileInput,
      shiftCard(),
      h('p', { class: 'notice rule' }, h('strong', {}, 'A loja nunca fica sozinha. '), 'Se o fechamento passar das 18h, você permanece até a loja fechar com a gestora.'),
      ...day.sections.map((section, i) =>
        h(
          'section',
          { class: 'card', 'aria-labelledby': `sec-${i}` },
          h(
            'div',
            { class: 'sec-head' },
            h('h2', { id: `sec-${i}` }, section.title),
            h(
              'span',
              { class: `sec-count${section.tasks.every((t) => t.done) ? ' full' : ''}`, 'aria-label': `${section.tasks.filter((t) => t.done).length} de ${section.tasks.length} feitas` },
              `${section.tasks.filter((t) => t.done).length}/${section.tasks.length}`,
            ),
          ),
          section.subtitle && h('p', { class: 'muted' }, section.subtitle),
          h('ul', { class: 'tasks' }, byDueTime(section.tasks).map(taskRow)),
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
      handleNfc();
    })
    .catch((err) => {
      body.replaceChildren(h('section', { class: 'card' }, h('p', { class: 'alert alert-error', role: 'alert' }, err.message)));
    });

  return root;
}
