import { h } from '../dom.js';

export function header({ title = 'Checkpoint', subtitle, actions } = {}) {
  return h(
    'header',
    { class: 'header' },
    h(
      'div',
      { class: 'header-row' },
      h(
        'div',
        { class: 'header-id' },
        h('img', { class: 'header-logo', src: '/img/logo.jpg', alt: 'Nil Cosméticos', width: '52', height: '52' }),
        h('div', {}, h('h1', { class: 'brand' }, title), subtitle && h('p', { class: 'sub' }, subtitle)),
      ),
      actions,
    ),
  );
}

/** Cabeçalho grande da tela de login, com a logo em destaque. */
export function loginHeader() {
  return h(
    'header',
    { class: 'header login-hero' },
    h('img', { class: 'login-logo', src: '/img/logo.jpg', alt: 'Nil Cosméticos e Perfumaria', width: '148', height: '148' }),
    h('h1', { class: 'brand' }, 'Checkpoint'),
    h('p', { class: 'sub' }, 'Rotina e conferência da loja'),
  );
}
