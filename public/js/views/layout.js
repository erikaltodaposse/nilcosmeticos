import { h } from '../dom.js';

export function header({ title = 'Checkpoint', subtitle, actions } = {}) {
  return h(
    'header',
    { class: 'header' },
    h(
      'div',
      { class: 'header-row' },
      h('div', {}, h('h1', { class: 'brand' }, title, ' ', h('span', {}, 'Nil')), subtitle && h('p', { class: 'sub' }, subtitle)),
      actions,
    ),
  );
}
