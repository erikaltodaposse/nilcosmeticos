import { api } from '../api.js';
import { h, fill, showError, busy } from '../dom.js';
import { WEEKDAYS, WEEKDAYS_SHORT, POST_KINDS } from '../weekdays.js';
import { formatDateKey } from '../format.js';

const MAX_POSTS = 10;
const monthName = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const todayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Manaus' }).format(new Date());
const weekdayOf = (key) => new Date(`${key}T12:00:00Z`).getUTCDay();
const byTime = (a, b) => (a.time ?? '').localeCompare(b.time ?? '') || a.id - b.id;

function monthDays(month) {
  const [y, m] = month.split('-').map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

export function postsEditor({ setGuard }) {
  let mode = 'month';
  let weekday = 1;
  let month = todayKey().slice(0, 7);
  let selected = todayKey();
  let weekly = [];
  let dated = [];
  let workdays = [1, 2, 3, 4, 5];
  let editing = null; // { id?, date? | weekday, time, kind, ... }
  let copying = null; // Set de datas escolhidas para receber a cópia do dia selecionado
  setGuard(() => !editing || window.confirm('Há uma postagem em edição não salva. Sair mesmo assim?'));

  const error = h('p', { class: 'alert alert-error', role: 'alert', hidden: true });
  const okMsg = h('p', { class: 'alert alert-ok', role: 'status', hidden: true });
  const tabs = h('div', { class: 'chips', role: 'group', 'aria-label': 'Tipo de roteiro' });
  const body = h('div', {}, h('p', { class: 'boot' }, 'Carregando o roteiro…'));

  const weeklyOf = (wd) => weekly.filter((p) => p.weekday === wd).sort(byTime);
  const datedOf = (date) => dated.filter((p) => p.date === date).sort(byTime);

  function flash(msg) {
    showError(error, '');
    showError(okMsg, msg);
  }

  async function run(button, label, fn) {
    showError(error, '');
    showError(okMsg, '');
    try {
      await busy(button, label, fn);
      return true;
    } catch (err) {
      showError(error, err.message);
      error.scrollIntoView({ block: 'nearest' });
      return false;
    }
  }

  function postForm() {
    const form = h('form', { class: 'card', novalidate: true });
    const formError = h('p', { class: 'alert alert-error', role: 'alert', hidden: true });
    const where = editing.date ? formatDateKey(editing.date) : `toda ${WEEKDAYS[editing.weekday].toLowerCase()}`;
    const area = (name, label, rows, max, hint) =>
      h('div', { class: 'field' }, h('label', { for: `post-${name}` }, label),
        h('textarea', { id: `post-${name}`, name, rows: String(rows), maxlength: String(max) }, editing[name] ?? ''),
        hint && h('p', { class: 'field-hint' }, hint));
    form.append(
      h('h2', {}, editing.id ? 'Editar postagem' : 'Nova postagem'),
      h('p', { class: 'muted' }, `Vale para ${where}.`),
      h(
        'div',
        { class: 'edit-row' },
        h('div', { class: 'field' }, h('label', { for: 'post-time' }, 'Horário'),
          h('input', { id: 'post-time', name: 'time', type: 'time', required: true, value: editing.time ?? '' })),
        h('div', { class: 'field' }, h('label', { for: 'post-kind' }, 'Tipo'),
          h('select', { id: 'post-kind', name: 'kind' },
            Object.entries(POST_KINDS).map(([v, label]) => h('option', { value: v, selected: editing.kind === v }, label)))),
      ),
      h('div', { class: 'field' }, h('label', { for: 'post-goal' }, 'Objetivo (o que a postagem quer)'),
        h('input', { id: 'post-goal', name: 'goal', type: 'text', maxlength: '120', value: editing.goal ?? '' })),
      area('image_prompt', 'Prompt da imagem', 5, 2000, 'Descreva só a cena e o produto. O estilo da marca (Ajustes) entra sozinho no fim.'),
      area('text_prompt', 'Prompt do texto (legenda ou mensagem)', 5, 2000, 'Peça ao ChatGPT o texto pronto: tom, tamanho e chamada para a loja.'),
      formError,
      h('button', { type: 'submit', class: 'btn' }, 'Salvar postagem'),
      h('button', { type: 'button', class: 'btn btn-outline mt', onclick: () => { editing = null; render(); } }, 'Cancelar'),
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = {
        ...(editing.date ? { date: editing.date } : { weekday: editing.weekday }),
        time: form.time.value,
        kind: form.kind.value,
        goal: form.goal.value,
        image_prompt: form.image_prompt.value,
        text_prompt: form.text_prompt.value,
      };
      try {
        await busy(form.querySelector('button[type=submit]'), 'Salvando…', () =>
          editing.id ? api.updatePost(editing.id, payload) : api.createPost(payload),
        );
        editing = null;
        await load();
        flash('Postagem salva.');
      } catch (err) {
        showError(formError, err.message);
      }
    });
    queueMicrotask(() => form.querySelector('input')?.focus());
    return form;
  }

  function postItem(p, { editable }) {
    return h(
      'li',
      { class: 'post-card' },
      h('div', { class: 'post-head' }, h('span', { class: 'tag tag-time' }, p.time ?? '--:--'), h('span', { class: 'post-kind' }, POST_KINDS[p.kind] ?? p.kind ?? '')),
      p.goal && h('p', { class: 'post-goal' }, p.goal),
      p.image_prompt && h('details', { class: 'prompt' }, h('summary', {}, 'Prompt da imagem'), h('pre', { class: 'prompt-text' }, p.image_prompt)),
      p.text_prompt && h('details', { class: 'prompt' }, h('summary', {}, 'Prompt do texto'), h('pre', { class: 'prompt-text' }, p.text_prompt)),
      editable && h(
        'div',
        { class: 'row-actions' },
        h('button', { type: 'button', class: 'mini', onclick: () => { editing = { ...p }; render(); } }, 'Editar'),
        h('button', {
          type: 'button',
          class: 'mini mini-danger',
          onclick: async (e) => {
            if (!window.confirm('Excluir esta postagem do roteiro?')) return;
            if (await run(e.currentTarget, 'Excluindo…', () => api.deletePost(p.id))) await load();
          },
        }, 'Excluir'),
      ),
    );
  }

  function postList(posts, opts) {
    return posts.length
      ? h('ol', { class: 'post-list flush' }, posts.map((p) => postItem(p, opts)))
      : h('p', { class: 'muted' }, 'Nenhuma postagem.');
  }

  // ---------- Semana padrão ----------

  function weeklyView() {
    const posts = weeklyOf(weekday);
    return [
      h(
        'section',
        { class: 'card' },
        h('h2', {}, 'Semana padrão'),
        h('p', { class: 'muted' }, 'Vale em todas as semanas, menos nos dias que têm programação própria no calendário.'),
        h('div', { class: 'chips', role: 'group', 'aria-label': 'Dia da semana' },
          WEEKDAYS_SHORT.map((label, d) =>
            h('button', {
              type: 'button',
              class: `chip${workdays.includes(d) ? '' : ' chip-off'}`,
              'aria-pressed': String(d === weekday),
              'aria-label': WEEKDAYS[d],
              onclick: () => { weekday = d; render(); },
            }, label))),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', {}, `${WEEKDAYS[weekday]} (${posts.length} de ${MAX_POSTS})`),
        postList(posts, { editable: true }),
        posts.length < MAX_POSTS &&
          h('button', { type: 'button', class: 'btn btn-outline mt', onclick: () => { editing = { weekday, time: '', kind: 'feed' }; render(); } }, 'Adicionar postagem'),
      ),
    ];
  }

  // ---------- Calendário do mês ----------

  function calendar() {
    const days = monthDays(month);
    const lead = weekdayOf(days[0]);
    const cells = [
      ...WEEKDAYS_SHORT.map((d) => h('span', { class: 'cal-head', 'aria-hidden': 'true' }, d.slice(0, 1))),
      ...Array.from({ length: lead }, () => h('span', {})),
      ...days.map((date) => {
        const own = datedOf(date).length;
        const count = own || weeklyOf(weekdayOf(date)).length;
        const off = !workdays.includes(weekdayOf(date));
        const picked = copying ? copying.has(date) : date === selected;
        const label = `${formatDateKey(date)}: ${count} postagens${own ? ', programação própria' : ', roteiro padrão'}${off ? ', sem expediente' : ''}`;
        return h('button', {
          type: 'button',
          class: `cal-day${own ? ' own' : ''}${off ? ' off' : ''}`,
          'aria-pressed': String(picked),
          'aria-label': label,
          disabled: Boolean(copying && date === selected),
          onclick: () => {
            if (copying) {
              if (copying.has(date)) copying.delete(date);
              else copying.add(date);
            } else {
              if (editing && !window.confirm('Descartar a postagem em edição?')) return;
              editing = null;
              selected = date;
            }
            render();
          },
        }, String(Number(date.slice(8))), h('small', { 'aria-hidden': 'true' }, off ? '–' : String(count)));
      }),
    ];
    return h(
      'section',
      { class: 'card' },
      h(
        'div',
        { class: 'cal-nav' },
        h('button', { type: 'button', class: 'mini', 'aria-label': 'Mês anterior', onclick: () => changeMonth(-1) }, 'Anterior'),
        h('h3', {}, monthName.format(new Date(`${month}-01T12:00:00Z`))),
        h('button', { type: 'button', class: 'mini', 'aria-label': 'Próximo mês', onclick: () => changeMonth(1) }, 'Próximo'),
      ),
      h('div', { class: 'cal' }, cells),
      h('p', { class: 'cal-legend' }, 'O número embaixo é a quantidade de postagens. Dias em rosa têm programação própria; os outros usam a semana padrão.'),
    );
  }

  function copyBar() {
    const n = copying.size;
    const workdaysOfMonth = monthDays(month).filter((d) => d !== selected && workdays.includes(weekdayOf(d)));
    const sameWeekday = workdaysOfMonth.filter((d) => weekdayOf(d) === weekdayOf(selected));
    const copyBtn = h('button', { type: 'button', class: 'btn', disabled: n === 0 }, n ? `Copiar para ${n} ${n === 1 ? 'dia' : 'dias'}` : 'Escolha os dias no calendário');
    copyBtn.addEventListener('click', async () => {
      const targets = [...copying].sort();
      const replacing = targets.filter((d) => datedOf(d).length).length;
      if (replacing && !window.confirm(`${replacing} dos dias escolhidos já têm programação própria, que será substituída. Continuar?`)) return;
      if (await run(copyBtn, 'Copiando…', () => api.copyPosts(selected, targets))) {
        copying = null;
        await load();
        flash(`Roteiro de ${formatDateKey(selected)} copiado para ${targets.length} ${targets.length === 1 ? 'dia' : 'dias'}.`);
      }
    });
    return h(
      'section',
      { class: 'card save-card' },
      h('h2', {}, 'Copiar para outros dias'),
      h('p', { class: 'muted' }, `Toque nos dias do calendário que vão receber as postagens de ${formatDateKey(selected)}.`),
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'mini', onclick: () => { sameWeekday.forEach((d) => copying.add(d)); render(); } }, `Todas as ${WEEKDAYS[weekdayOf(selected)].toLowerCase()}s do mês`),
        h('button', { type: 'button', class: 'mini', onclick: () => { workdaysOfMonth.forEach((d) => copying.add(d)); render(); } }, 'Todos os dias úteis do mês'),
        h('button', { type: 'button', class: 'mini', onclick: () => { copying.clear(); render(); } }, 'Limpar escolha')),
      copyBtn,
      h('button', { type: 'button', class: 'btn btn-outline mt', onclick: () => { copying = null; render(); } }, 'Cancelar'),
    );
  }

  function dayPanel() {
    const own = datedOf(selected);
    const standard = weeklyOf(weekdayOf(selected));
    const effective = own.length ? own : standard;
    const title = formatDateKey(selected).replace(/^./, (c) => c.toUpperCase());

    const customize = h('button', { type: 'button', class: 'btn btn-outline' }, 'Personalizar este dia');
    customize.addEventListener('click', async () => {
      // Copia o padrão como programação própria da data, para editar sem mexer nas outras semanas.
      const ok = await run(customize, 'Preparando…', async () => {
        for (const p of standard) {
          await api.createPost({ date: selected, time: p.time, kind: p.kind, goal: p.goal, image_prompt: p.image_prompt, text_prompt: p.text_prompt });
        }
      });
      if (ok) {
        await load();
        flash('Agora este dia tem programação própria. Edite à vontade: as outras semanas não mudam.');
      }
    });

    const clear = h('button', { type: 'button', class: 'btn btn-outline mt' }, 'Voltar ao roteiro padrão');
    clear.addEventListener('click', async () => {
      if (!window.confirm('Apagar a programação deste dia? Ele volta a usar a semana padrão.')) return;
      if (await run(clear, 'Apagando…', () => api.clearPostsDay(selected))) {
        await load();
        flash('O dia voltou ao roteiro padrão.');
      }
    });

    return h(
      'section',
      { class: 'card' },
      h('h2', {}, title),
      h('p', { class: 'muted' }, own.length
        ? `Programação própria: ${own.length} de ${MAX_POSTS} postagens.`
        : `Usa a semana padrão de ${WEEKDAYS[weekdayOf(selected)].toLowerCase()} (${standard.length} postagens).`),
      postList(effective, { editable: own.length > 0 }),
      own.length > 0 && own.length < MAX_POSTS &&
        h('button', { type: 'button', class: 'btn btn-outline mt', onclick: () => { editing = { date: selected, time: '', kind: 'feed' }; render(); } }, 'Adicionar postagem neste dia'),
      own.length === 0 && standard.length > 0 && h('div', { class: 'mt' }, customize),
      own.length === 0 && standard.length === 0 &&
        h('button', { type: 'button', class: 'btn btn-outline mt', onclick: () => { editing = { date: selected, time: '', kind: 'feed' }; render(); } }, 'Programar postagens neste dia'),
      effective.length > 0 &&
        h('button', { type: 'button', class: 'btn btn-outline mt', onclick: () => { copying = new Set(); render(); } }, 'Copiar para outros dias'),
      own.length > 0 && clear,
    );
  }

  async function changeMonth(delta) {
    if (editing && !window.confirm('Descartar a postagem em edição?')) return;
    editing = null;
    copying = null;
    month = shiftMonth(month, delta);
    selected = `${month}-01`;
    await load();
  }

  function render() {
    tabs.replaceChildren(
      ...[['month', 'Calendário do mês'], ['week', 'Semana padrão']].map(([id, label]) =>
        h('button', {
          type: 'button',
          class: 'chip',
          'aria-pressed': String(mode === id),
          onclick: () => {
            if (editing && !window.confirm('Descartar a postagem em edição?')) return;
            editing = null;
            copying = null;
            mode = id;
            render();
          },
        }, label)),
    );
    if (editing) {
      fill(body, error, postForm());
      return;
    }
    if (mode === 'week') fill(body, error, okMsg, ...weeklyView());
    else fill(body, error, okMsg, calendar(), copying ? copyBar() : dayPanel());
  }

  async function load() {
    try {
      const days = monthDays(month);
      const [posts, settings] = await Promise.all([api.listPosts(days[0], days[days.length - 1]), api.getSettings()]);
      weekly = posts.weekly;
      dated = posts.dated;
      workdays = settings.settings.dias_expediente;
      if (!selected.startsWith(month)) selected = days[0];
      render();
    } catch (err) {
      body.replaceChildren(h('p', { class: 'alert alert-error', role: 'alert' }, err.message));
    }
  }

  load();
  return h(
    'div',
    {},
    h(
      'section',
      { class: 'card' },
      h('h2', {}, 'Roteiro de postagens'),
      h('p', { class: 'muted' }, `Até ${MAX_POSTS} postagens por dia, cada uma com horário e prompts para o ChatGPT. A funcionária copia o prompt ou abre direto no ChatGPT.`),
      tabs,
    ),
    body,
  );
}

