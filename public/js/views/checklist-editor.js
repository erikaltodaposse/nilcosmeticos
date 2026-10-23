import { api } from '../api.js';
import { h, fill, showError, busy } from '../dom.js';
import { WEEKDAYS, WEEKDAYS_SHORT, POST_SLOTS, AUTO_LABELS } from '../weekdays.js';

let uid = 0;
const nextId = () => `ce-${++uid}`;

function move(list, index, delta) {
  const target = index + delta;
  if (target < 0 || target >= list.length) return;
  [list[index], list[target]] = [list[target], list[index]];
}

export function checklistEditor({ setGuard }) {
  let weekday = 1;
  let model = null;
  let settings = null;
  let dirty = false;

  const error = h('p', { class: 'alert alert-error', role: 'alert', hidden: true });
  const okMsg = h('p', { class: 'alert alert-ok', role: 'status', hidden: true });
  const dayChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Dia da semana' });
  const body = h('div', {}, h('p', { class: 'boot' }, 'Carregando o checklist…'));
  const totalLabel = h('p', { class: 'total', 'aria-live': 'polite' });

  setGuard(() => !dirty || window.confirm('Há alterações não salvas no checklist. Sair mesmo assim?'));

  function markDirty() {
    dirty = true;
    showError(okMsg, '');
    updateTotal();
  }

  function updateTotal() {
    if (!model) return;
    const total = model.sections.reduce((sum, s) => sum + s.tasks.reduce((t, task) => t + (Number(task.points) || 0), 0), 0);
    const meta = settings?.meta_pontos ?? 150;
    totalLabel.textContent = `Total do dia: ${total} pontos. Meta: ${meta}.${total < meta ? ' O total está abaixo da meta: nem marcando tudo a funcionária chega a 100%.' : ''}`;
  }

  function renderChips() {
    dayChips.replaceChildren(
      ...WEEKDAYS.map((name, wd) => {
        const off = settings && !settings.dias_expediente.includes(wd);
        return h(
          'button',
          {
            type: 'button',
            class: `chip${off ? ' chip-off' : ''}`,
            'aria-pressed': String(wd === weekday),
            'aria-label': `${name}${off ? ' (sem expediente)' : ''}`,
            onclick: () => {
              if (wd === weekday) return;
              if (dirty && !window.confirm('Há alterações não salvas. Trocar de dia e descartar?')) return;
              weekday = wd;
              load();
            },
          },
          WEEKDAYS_SHORT[wd],
        );
      }),
    );
  }

  function field(label, input, hint) {
    const id = input.id || nextId();
    input.id = id;
    return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint && h('p', { class: 'field-hint' }, hint));
  }

  function textInput(value, onInput, attrs = {}) {
    const el = h('input', { type: 'text', value: value ?? '', ...attrs });
    el.addEventListener('input', () => { onInput(el.value); markDirty(); });
    return el;
  }

  function taskEditor(section, task, tIdx) {
    const textId = nextId();
    const points = h('input', { type: 'number', inputmode: 'numeric', min: '0', max: '1000', step: '1', value: String(task.points), id: nextId() });
    points.addEventListener('input', () => { task.points = points.value === '' ? '' : Number(points.value); markDirty(); });

    const photo = h('input', { type: 'checkbox', id: nextId(), checked: task.requires_photo });
    photo.addEventListener('change', () => { task.requires_photo = photo.checked; markDirty(); });

    const slot = h(
      'select',
      { id: nextId() },
      h('option', { value: '' }, 'Não é post'),
      Object.entries(POST_SLOTS).map(([v, label]) => h('option', { value: v, selected: String(task.post_slot) === v }, `Post ${v} — ${label}`)),
    );
    slot.addEventListener('change', () => { task.post_slot = slot.value ? Number(slot.value) : null; markDirty(); });

    const structural = (fn) => () => { fn(); markDirty(); render(); };
    return h(
      'li',
      { class: 'edit-task' },
      h('label', { class: 'sr-only', for: textId }, `Texto da tarefa ${tIdx + 1}`),
      h('textarea', { id: textId, rows: '2', maxlength: '200', oninput: (e) => { task.text = e.target.value; markDirty(); } }, task.text),
      task.auto && h('p', { class: 'field-hint' }, `Marcada automaticamente no ${AUTO_LABELS[task.auto]}.`),
      h(
        'div',
        { class: 'edit-row' },
        h('div', { class: 'field field-inline' }, h('label', { for: points.id }, 'Pontos'), points),
        h('div', { class: 'check-field' }, photo, h('label', { for: photo.id }, 'Exige foto')),
      ),
      h('div', { class: 'field' }, h('label', { for: slot.id }, 'Roteiro'), slot),
      h(
        'div',
        { class: 'row-actions' },
        h('button', { type: 'button', class: 'mini', disabled: tIdx === 0, onclick: structural(() => move(section.tasks, tIdx, -1)) }, 'Subir'),
        h('button', { type: 'button', class: 'mini', disabled: tIdx === section.tasks.length - 1, onclick: structural(() => move(section.tasks, tIdx, 1)) }, 'Descer'),
        h(
          'button',
          {
            type: 'button',
            class: 'mini mini-danger',
            onclick: () => {
              if (window.confirm(`Excluir a tarefa "${task.text || 'sem texto'}"?`)) structural(() => section.tasks.splice(tIdx, 1))();
            },
          },
          'Excluir',
        ),
      ),
    );
  }

  function sectionEditor(section, sIdx) {
    const structural = (fn) => () => { fn(); markDirty(); render(); };
    return h(
      'section',
      { class: 'card' },
      field('Nome do bloco', textInput(section.title, (v) => { section.title = v; }, { maxlength: '60' })),
      field('Subtítulo (opcional)', textInput(section.subtitle, (v) => { section.subtitle = v; }, { maxlength: '120' })),
      h(
        'div',
        { class: 'row-actions' },
        h('button', { type: 'button', class: 'mini', disabled: sIdx === 0, onclick: structural(() => move(model.sections, sIdx, -1)) }, 'Subir bloco'),
        h('button', { type: 'button', class: 'mini', disabled: sIdx === model.sections.length - 1, onclick: structural(() => move(model.sections, sIdx, 1)) }, 'Descer bloco'),
        h(
          'button',
          {
            type: 'button',
            class: 'mini mini-danger',
            onclick: () => {
              const msg = `Excluir o bloco "${section.title || 'sem nome'}" e suas ${section.tasks.length} tarefas?`;
              if (window.confirm(msg)) structural(() => model.sections.splice(sIdx, 1))();
            },
          },
          'Excluir bloco',
        ),
      ),
      h('h3', { class: 'sub-title' }, `Tarefas (${section.tasks.length})`),
      section.tasks.length
        ? h('ol', { class: 'edit-tasks' }, section.tasks.map((task, i) => taskEditor(section, task, i)))
        : h('p', { class: 'muted' }, 'Este bloco ainda não tem tarefas. Adicione a primeira abaixo.'),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-outline',
          onclick: structural(() => section.tasks.push({ text: '', points: 5, requires_photo: false, post_slot: null, auto: null })),
        },
        'Adicionar tarefa',
      ),
    );
  }

  function render() {
    renderChips();
    const isOff = !settings.dias_expediente.includes(weekday);
    const otherDays = settings.dias_expediente.filter((d) => d !== weekday);
    const applyBoxes = otherDays.map((d) => {
      const id = `apply-${d}`;
      return h('span', { class: 'check-field' }, h('input', { type: 'checkbox', id, value: String(d), class: 'apply-day' }), h('label', { for: id }, WEEKDAYS[d]));
    });

    const save = h('button', { type: 'button', class: 'btn' }, 'Salvar checklist');
    save.addEventListener('click', async () => {
      showError(error, '');
      showError(okMsg, '');
      const also = [...body.querySelectorAll('.apply-day:checked')].map((el) => Number(el.value));
      try {
        const res = await busy(save, 'Salvando…', () => api.saveChecklist(weekday, { ...model, also_weekdays: also }));
        model = res.checklist;
        dirty = false;
        render();
        const names = res.saved_weekdays.map((d) => WEEKDAYS[d]).join(', ');
        showError(okMsg, `Salvo para: ${names}. Vale para os próximos dias e para hoje, se o dia ainda não começou. Dias já registrados não mudam.`);
        okMsg.scrollIntoView({ block: 'nearest' });
      } catch (err) {
        showError(error, err.message);
        error.scrollIntoView({ block: 'nearest' });
      }
    });

    const restore = h('button', { type: 'button', class: 'btn btn-outline' }, 'Restaurar padrão deste dia');
    restore.addEventListener('click', async () => {
      if (!window.confirm(`Restaurar o checklist padrão de ${WEEKDAYS[weekday].toLowerCase()} (14 tarefas, 150 pontos)? As alterações deste dia serão substituídas.`)) return;
      try {
        const res = await busy(restore, 'Restaurando…', () => api.restoreChecklist(weekday));
        model = res.checklist;
        dirty = false;
        render();
        showError(okMsg, 'Checklist padrão restaurado.');
      } catch (err) {
        showError(error, err.message);
      }
    });

    fill(
      body,
      isOff && h('p', { class: 'notice' }, `${WEEKDAYS[weekday]} está sem expediente. Este checklist só é usado se o dia for incluído em Ajustes.`),
      h(
        'section',
        { class: 'card' },
        h('h2', {}, WEEKDAYS[weekday]),
        h('p', { class: 'muted' }, `Versão ${model.version ?? 1}. Ao salvar, cria-se uma nova versão e o histórico fica intacto.`),
        field(
          'Foco de limpeza do dia',
          textInput(model.cleaning_focus, (v) => { model.cleaning_focus = v; }, { maxlength: '120' }),
          'Entra no lugar de {foco} no texto da tarefa de limpeza.',
        ),
      ),
      ...model.sections.map(sectionEditor),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-outline',
          onclick: () => {
            model.sections.push({ title: 'Novo bloco', subtitle: '', tasks: [] });
            markDirty();
            render();
          },
        },
        'Adicionar bloco',
      ),
      h(
        'section',
        { class: 'card save-card' },
        totalLabel,
        otherDays.length > 0 && h('fieldset', { class: 'apply' }, h('legend', {}, 'Aplicar estes blocos e tarefas também a:'), applyBoxes,
          h('p', { class: 'field-hint' }, 'Cada dia mantém o próprio foco de limpeza.')),
        error,
        okMsg,
        save,
        h('div', { class: 'mt' }, restore),
      ),
    );
    updateTotal();
  }

  async function load() {
    showError(error, '');
    showError(okMsg, '');
    body.replaceChildren(h('p', { class: 'boot' }, 'Carregando o checklist…'));
    try {
      if (!settings) settings = (await api.getSettings()).settings;
      model = (await api.getChecklist(weekday)).checklist;
      dirty = false;
      render();
    } catch (err) {
      body.replaceChildren(h('p', { class: 'alert alert-error', role: 'alert' }, err.message));
    }
  }

  load();
  return h(
    'div',
    {},
    h('section', { class: 'card' }, h('h2', {}, 'Tarefas do dia'), h('p', { class: 'muted' }, 'Escolha o dia da semana, ajuste blocos e tarefas e salve.'), dayChips),
    body,
  );
}
