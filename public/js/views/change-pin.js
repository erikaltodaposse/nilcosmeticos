import { api } from '../api.js';
import { h, showError, busy } from '../dom.js';
import { header } from './layout.js';

export function changePinView({ user, onDone, onLogout }) {
  const error = h('p', { class: 'alert alert-error', role: 'alert', hidden: true });

  const field = (id, label, autocomplete) =>
    h(
      'div',
      { class: 'field' },
      h('label', { for: id }, label),
      h('input', {
        id, name: id, class: 'pin', type: 'password', inputmode: 'numeric', autocomplete,
        pattern: '[0-9]*', minlength: '4', maxlength: '6', required: true,
      }),
    );

  const form = h(
    'form',
    { novalidate: true },
    field('current', 'PIN atual', 'current-password'),
    field('next', 'Novo PIN (4 a 6 números)', 'new-password'),
    field('confirm', 'Repita o novo PIN', 'new-password'),
    h('button', { class: 'btn', type: 'submit' }, 'Salvar novo PIN'),
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const current = form.current.value.trim();
    const next = form.next.value.trim();
    if (!/^\d{4,6}$/.test(next)) return showError(error, 'O novo PIN precisa ter de 4 a 6 números.');
    if (next !== form.confirm.value.trim()) return showError(error, 'Os dois campos do novo PIN não conferem.');
    showError(error, '');
    try {
      const result = await busy(form.querySelector('button'), 'Salvando…', () => api.changePin(current, next));
      onDone(result.user);
    } catch (err) {
      showError(error, err.message);
    }
  });

  return h(
    'div',
    {},
    header({
      subtitle: `Olá, ${user.name}`,
      actions: h('button', { class: 'btn btn-ghost', type: 'button', onclick: onLogout }, 'Sair'),
    }),
    h(
      'div',
      { class: 'container' },
      h(
        'section',
        { class: 'card', 'aria-labelledby': 'pin-title' },
        h('h2', { id: 'pin-title' }, 'Crie seu PIN'),
        h('p', { class: 'hint' }, 'Este é o seu primeiro acesso. Troque o PIN inicial por um que só você saiba.'),
        error,
        form,
      ),
    ),
  );
}
