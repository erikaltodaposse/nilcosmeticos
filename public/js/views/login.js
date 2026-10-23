import { api } from '../api.js';
import { h, showError, busy } from '../dom.js';
import { loginHeader } from './layout.js';

export function loginView({ onLogin }) {
  let mode = 'pin';
  const error = h('p', { class: 'alert alert-error', role: 'alert', hidden: true });

  const pinTab = h('button', { class: 'tab', type: 'button', role: 'tab', id: 'tab-pin', 'aria-controls': 'login-form' }, 'Funcionária');
  const pwdTab = h('button', { class: 'tab', type: 'button', role: 'tab', id: 'tab-pwd', 'aria-controls': 'login-form' }, 'Gestora');
  const form = h('form', { id: 'login-form', role: 'tabpanel', novalidate: true });

  function pinFields() {
    return [
      h(
        'div',
        { class: 'field' },
        h('label', { for: 'pin' }, 'PIN'),
        h('input', {
          id: 'pin', name: 'pin', class: 'pin', type: 'password', inputmode: 'numeric',
          autocomplete: 'current-password', pattern: '[0-9]*', minlength: '4', maxlength: '6', required: true,
        }),
      ),
    ];
  }

  function passwordFields() {
    return [
      h(
        'div',
        { class: 'field' },
        h('label', { for: 'email' }, 'E-mail'),
        h('input', { id: 'email', name: 'email', type: 'email', autocomplete: 'username', required: true }),
      ),
      h(
        'div',
        { class: 'field' },
        h('label', { for: 'password' }, 'Senha'),
        h('input', { id: 'password', name: 'password', type: 'password', autocomplete: 'current-password', required: true }),
      ),
    ];
  }

  function render() {
    pinTab.setAttribute('aria-selected', String(mode === 'pin'));
    pwdTab.setAttribute('aria-selected', String(mode === 'password'));
    form.setAttribute('aria-labelledby', mode === 'pin' ? 'tab-pin' : 'tab-pwd');
    showError(error, '');
    form.replaceChildren(
      ...(mode === 'pin' ? pinFields() : passwordFields()),
      h('button', { class: 'btn', type: 'submit' }, 'Entrar'),
    );
    form.querySelector('input').focus();
  }

  pinTab.addEventListener('click', () => { mode = 'pin'; render(); });
  pwdTab.addEventListener('click', () => { mode = 'password'; render(); });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showError(error, '');
    const button = form.querySelector('button[type=submit]');
    try {
      let result;
      if (mode === 'pin') {
        const pin = form.pin.value.trim();
        if (!/^\d{4,6}$/.test(pin)) return showError(error, 'O PIN tem de 4 a 6 números.');
        result = await busy(button, 'Entrando…', () => api.loginPin(pin));
      } else {
        const email = form.email.value.trim();
        const password = form.password.value;
        if (!email || !password) return showError(error, 'Informe e-mail e senha.');
        result = await busy(button, 'Entrando…', () => api.loginPassword(email, password));
      }
      onLogin(result.user);
    } catch (err) {
      showError(error, err.message);
      const first = form.querySelector('input[type=password]');
      if (first) { first.value = ''; first.focus(); }
    }
  });

  const root = h(
    'div',
    {},
    loginHeader(),
    h(
      'div',
      { class: 'container' },
      h(
        'section',
        { class: 'card', 'aria-labelledby': 'login-title' },
        h('h2', { id: 'login-title' }, 'Entrar'),
        h('p', { class: 'hint' }, 'Funcionária entra com o PIN. Gestora entra com e-mail e senha.'),
        h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Tipo de acesso' }, pinTab, pwdTab),
        error,
        form,
      ),
    ),
  );
  queueMicrotask(render);
  return root;
}
