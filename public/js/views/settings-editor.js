import { api } from '../api.js';
import { h, showError, busy } from '../dom.js';
import { WEEKDAYS } from '../weekdays.js';

export function settingsEditor({ setGuard }) {
  let dirty = false;
  setGuard(() => !dirty || window.confirm('Há ajustes não salvos. Sair mesmo assim?'));

  const error = h('p', { class: 'alert alert-error', role: 'alert', hidden: true });
  const okMsg = h('p', { class: 'alert alert-ok', role: 'status', hidden: true });
  const form = h('form', { novalidate: true }, h('p', { class: 'boot' }, 'Carregando…'));
  form.addEventListener('input', () => { dirty = true; showError(okMsg, ''); });

  const input = (id, label, attrs, hint) =>
    h('div', { class: 'field' }, h('label', { for: id }, label), h('input', { id, name: id, ...attrs }), hint && h('p', { class: 'field-hint' }, hint));

  function render(s) {
    form.replaceChildren(
      input('nome_loja', 'Nome da loja', { type: 'text', maxlength: '80', value: s.nome_loja, required: true }),
      input('meta_pontos', 'Meta diária de pontos', { type: 'number', inputmode: 'numeric', min: '1', max: '10000', step: '1', value: String(s.meta_pontos) }),
      h(
        'div',
        { class: 'edit-row' },
        input('turno_inicio', 'Início do turno', { type: 'time', value: s.turno_inicio }),
        input('turno_fim', 'Fim do turno', { type: 'time', value: s.turno_fim }),
      ),
      input('bonus_base', 'Bônus-base (R$)', { type: 'text', inputmode: 'decimal', value: String(s.bonus_base).replace('.', ',') },
        'Ouro paga 100%, Prata 75% e Bronze 50% deste valor. Deixe 0 enquanto não houver bônus.'),
      h(
        'fieldset',
        { class: 'apply' },
        h('legend', {}, 'Dias com expediente'),
        WEEKDAYS.map((name, d) =>
          h('span', { class: 'check-field' },
            h('input', { type: 'checkbox', id: `wd-${d}`, name: 'dias', value: String(d), checked: s.dias_expediente.includes(d) }),
            h('label', { for: `wd-${d}` }, name)),
        ),
      ),
      error,
      okMsg,
      h('button', { type: 'submit', class: 'btn' }, 'Salvar ajustes'),
    );
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showError(error, '');
    const body = {
      nome_loja: form.nome_loja.value,
      meta_pontos: Number(form.meta_pontos.value),
      turno_inicio: form.turno_inicio.value,
      turno_fim: form.turno_fim.value,
      bonus_base: form.bonus_base.value.trim() || '0',
      dias_expediente: [...form.querySelectorAll('input[name=dias]:checked')].map((el) => Number(el.value)),
    };
    try {
      const res = await busy(form.querySelector('button[type=submit]'), 'Salvando…', () => api.saveSettings(body));
      dirty = false;
      render(res.settings);
      showError(okMsg, 'Ajustes salvos.');
    } catch (err) {
      showError(error, err.message);
    }
  });

  api
    .getSettings()
    .then((res) => render(res.settings))
    .catch((err) => form.replaceChildren(h('p', { class: 'alert alert-error', role: 'alert' }, err.message)));

  return h('section', { class: 'card' }, h('h2', {}, 'Ajustes da loja'), h('p', { class: 'muted' }, 'Meta, turno, bônus e dias de expediente.'), form);
}
