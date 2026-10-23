import { api } from '../api.js';
import { h, showError, busy } from '../dom.js';
import { WEEKDAYS, WEEKDAYS_SHORT, POST_SLOTS } from '../weekdays.js';

const FIELDS = [
  { key: 'channel', label: 'Canal', max: 60 },
  { key: 'product_line', label: 'Linha de produto', max: 80 },
  { key: 'hook', label: 'Gancho', max: 300, area: 2 },
  { key: 'caption', label: 'Legenda', max: 2000, area: 5 },
  { key: 'cta', label: 'Chamada para ação', max: 300, area: 2 },
];

export function postsEditor({ setGuard }) {
  let weekday = 1;
  let posts = [];
  let editing = null; // { id?, weekday, slot, ... }
  setGuard(() => !editing || window.confirm('Há um post em edição não salvo. Sair mesmo assim?'));

  const error = h('p', { class: 'alert alert-error', role: 'alert', hidden: true });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Dia da semana' });
  const list = h('div', {}, h('p', { class: 'boot' }, 'Carregando o roteiro…'));

  function postForm() {
    const form = h('form', { class: 'card', novalidate: true });
    const formError = h('p', { class: 'alert alert-error', role: 'alert', hidden: true });
    form.append(
      h('h2', {}, editing.id ? 'Editar post' : 'Novo post'),
      h('p', { class: 'muted' }, `${WEEKDAYS[editing.weekday]}, post ${editing.slot} (${POST_SLOTS[editing.slot]})`),
      ...FIELDS.map((f) => {
        const id = `post-${f.key}`;
        const control = f.area
          ? h('textarea', { id, name: f.key, rows: String(f.area), maxlength: String(f.max) }, editing[f.key] ?? '')
          : h('input', { id, name: f.key, type: 'text', maxlength: String(f.max), value: editing[f.key] ?? '' });
        return h('div', { class: 'field' }, h('label', { for: id }, f.label), control);
      }),
      formError,
      h('button', { type: 'submit', class: 'btn' }, 'Salvar post'),
      h('button', { type: 'button', class: 'btn btn-outline mt', onclick: () => { editing = null; render(); } }, 'Cancelar'),
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = { weekday: editing.weekday, slot: editing.slot };
      for (const f of FIELDS) body[f.key] = form[f.key].value;
      try {
        await busy(form.querySelector('button[type=submit]'), 'Salvando…', () =>
          editing.id ? api.updatePost(editing.id, body) : api.createPost(body),
        );
        editing = null;
        await load();
      } catch (err) {
        showError(formError, err.message);
      }
    });
    queueMicrotask(() => form.querySelector('input, textarea')?.focus());
    return form;
  }

  function render() {
    chips.replaceChildren(
      ...WEEKDAYS_SHORT.map((label, d) =>
        h('button', {
          type: 'button', class: 'chip', 'aria-pressed': String(d === weekday), 'aria-label': WEEKDAYS[d],
          onclick: () => {
            if (editing && !window.confirm('Descartar o post em edição?')) return;
            editing = null;
            weekday = d;
            render();
          },
        }, label),
      ),
    );
    if (editing) {
      list.replaceChildren(postForm());
      return;
    }
    const ofDay = posts.filter((p) => p.weekday === weekday);
    list.replaceChildren(
      error,
      ...[1, 2, 3].map((slot) => {
        const items = ofDay.filter((p) => p.slot === slot);
        return h(
          'section',
          { class: 'card' },
          h('h2', {}, `Post ${slot}`),
          h('p', { class: 'muted' }, POST_SLOTS[slot]),
          items.length === 0 && h('p', { class: 'muted mt' }, 'Sem roteiro para este horário. A funcionária verá um aviso para seguir a linha de produto do dia.'),
          ...items.map((p) =>
            h(
              'div',
              { class: 'post-panel post-item' },
              p.product_line && h('p', {}, h('strong', {}, 'Linha: '), p.product_line),
              p.hook && h('p', {}, h('strong', {}, 'Gancho: '), p.hook),
              p.caption && h('p', { class: 'caption' }, p.caption),
              p.cta && h('p', {}, h('strong', {}, 'Chamada: '), p.cta),
              h(
                'div',
                { class: 'row-actions' },
                h('button', { type: 'button', class: 'mini', onclick: () => { editing = { ...p }; render(); } }, 'Editar'),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'mini mini-danger',
                    onclick: async () => {
                      if (!window.confirm('Excluir este post do roteiro?')) return;
                      try {
                        await api.deletePost(p.id);
                        await load();
                      } catch (err) {
                        showError(error, err.message);
                      }
                    },
                  },
                  'Excluir',
                ),
              ),
            ),
          ),
          h('button', { type: 'button', class: 'btn btn-outline mt', onclick: () => { editing = { weekday, slot }; render(); } },
            items.length ? 'Adicionar outra opção' : 'Cadastrar post'),
        );
      }),
    );
  }

  async function load() {
    try {
      posts = (await api.listPosts()).posts;
      render();
    } catch (err) {
      list.replaceChildren(h('p', { class: 'alert alert-error', role: 'alert' }, err.message));
    }
  }

  load();
  return h(
    'div',
    {},
    h('section', { class: 'card' }, h('h2', {}, 'Roteiro de postagens'), h('p', { class: 'muted' }, 'Três horários por dia. A funcionária vê o texto e copia na hora do post.'), chips),
    list,
  );
}
