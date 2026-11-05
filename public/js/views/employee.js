import { h } from '../dom.js';
import { todayView } from './today.js';
import { progressView } from './progress.js';

const TABS = [
  { id: 'today', label: 'Hoje' },
  { id: 'progress', label: 'Minha evolução' },
];

/** App da funcionária: abas Hoje e Minha evolução. */
export function employeeView({ user, today, nfcToken, onLogout, onTitle }) {
  const root = h('div', {});

  function nav(current) {
    return h(
      'nav',
      { class: 'container nav-wrap', 'aria-label': 'Telas' },
      h('div', { class: 'tabs', role: 'tablist' },
        TABS.map((tab) =>
          h('button', {
            type: 'button',
            class: 'tab',
            role: 'tab',
            'aria-selected': String(tab.id === current),
            onclick: () => tab.id !== current && open(tab.id),
          }, tab.label))),
    );
  }

  function open(id, token = null) {
    const tab = TABS.find((t) => t.id === id);
    root.replaceChildren(
      id === 'today'
        ? todayView({ user, date: today, nfcToken: token, onLogout, nav: nav(id) })
        : progressView({ user, onLogout, nav: nav(id) }),
    );
    onTitle?.(tab.label);
    window.scrollTo(0, 0);
  }

  open('today', nfcToken);
  return root;
}
