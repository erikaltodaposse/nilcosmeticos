import { h } from '../dom.js';
import { header } from './layout.js';
import { checklistEditor } from './checklist-editor.js';
import { postsEditor } from './posts-editor.js';
import { settingsEditor } from './settings-editor.js';
import { dashboardView } from './dashboard.js';

const TABS = [
  { id: 'dashboard', label: 'Painel', view: dashboardView },
  { id: 'checklist', label: 'Tarefas', view: checklistEditor },
  { id: 'posts', label: 'Roteiro', view: postsEditor },
  { id: 'settings', label: 'Ajustes', view: settingsEditor },
];

export function managerView({ user, today, onLogout }) {
  let current = null;
  let guard = null; // a aba atual pode impedir a troca se houver alteração não salva
  const content = h('div', { class: 'container' });
  const buttons = TABS.map((tab) =>
    h('button', { type: 'button', class: 'tab', role: 'tab', id: `mtab-${tab.id}`, onclick: () => open(tab.id) }, tab.label),
  );

  function open(id) {
    if (id === current) return;
    if (guard && !guard()) return;
    current = id;
    TABS.forEach((tab, i) => buttons[i].setAttribute('aria-selected', String(tab.id === id)));
    const tab = TABS.find((t) => t.id === id);
    guard = null;
    content.replaceChildren(tab.view({ today, setGuard: (fn) => { guard = fn; } }));
  }

  const root = h(
    'div',
    {},
    header({
      title: 'Gestão',
      subtitle: `Olá, ${user.name}`,
      actions: h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => (!guard || guard()) && onLogout() }, 'Sair'),
    }),
    h('nav', { class: 'container nav-wrap', 'aria-label': 'Áreas da gestão' }, h('div', { class: 'tabs tabs-4', role: 'tablist' }, buttons)),
    content,
  );
  open('dashboard');
  return root;
}
