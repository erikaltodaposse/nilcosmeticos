import { h } from '../dom.js';
import { header } from './layout.js';

// Tela provisória da Fase 1: confirma o login. "Hoje" e o painel chegam nas próximas fases.
export function homeView({ user, onLogout }) {
  const isManager = user.role === 'manager';
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
        { class: 'card' },
        h('h2', {}, isManager ? 'Painel da gestora' : 'Seu dia'),
        h(
          'p',
          { class: 'hint' },
          isManager
            ? 'Você entrou como gestora. O painel com adesão, histórico e fotos entra na próxima etapa.'
            : 'Você entrou. O checklist do dia, com ponto e tarefas, entra na próxima etapa.',
        ),
        h('p', { class: 'notice' }, 'A loja nunca fica sozinha.'),
      ),
    ),
  );
}
