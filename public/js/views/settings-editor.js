import { api } from '../api.js';
import { h, fill, showError, busy } from '../dom.js';
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
      h(
        'fieldset',
        { class: 'apply' },
        h('legend', {}, 'Ponto pela etiqueta NFC'),
        h('span', { class: 'check-field' },
          h('input', { type: 'checkbox', id: 'nfc-required', name: 'ponto_exige_nfc', checked: s.ponto_exige_nfc }),
          h('label', { for: 'nfc-required' }, 'Exigir a etiqueta para registrar entrada e saída')),
        h('p', { class: 'field-hint' }, 'Ligue só depois de gravar a etiqueta (instruções abaixo). Desligado, o botão comum também funciona.'),
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
      ponto_exige_nfc: form.ponto_exige_nfc.checked,
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

  return h(
    'div',
    {},
    h('section', { class: 'card' }, h('h2', {}, 'Ajustes da loja'), h('p', { class: 'muted' }, 'Meta, turno, bônus, dias de expediente e ponto pela etiqueta.'), form),
    nfcCard(),
  );
}

function nfcCard() {
  const card = h('section', { class: 'card', 'aria-labelledby': 'nfc-title' }, h('p', { class: 'boot' }, 'Carregando…'));
  const msg = h('p', { class: 'copied', role: 'status' });

  function render({ path }) {
    const url = `${window.location.origin}${path}`;
    const input = h('input', { id: 'nfc-url', type: 'text', readonly: true, value: url });
    input.addEventListener('focus', () => input.select());
    const rotate = h('button', { type: 'button', class: 'btn btn-outline mt' }, 'Gerar novo código');
    rotate.addEventListener('click', async () => {
      if (!window.confirm('Gerar um novo código? A etiqueta atual para de funcionar até ser gravada de novo.')) return;
      try {
        render(await busy(rotate, 'Gerando…', () => api.rotateNfc()));
        msg.textContent = 'Novo código gerado. Grave o link novo na etiqueta.';
      } catch (err) {
        msg.textContent = err.message;
      }
    });
    fill(
      card,
      h('h2', { id: 'nfc-title' }, 'Etiqueta NFC do ponto'),
      h('p', { class: 'muted' }, 'A funcionária encosta o celular na etiqueta da loja e o app registra a entrada. Na saída, ele pede confirmação.'),
      h('div', { class: 'field mt' }, h('label', { for: 'nfc-url' }, 'Link para gravar na etiqueta'), input),
      h('button', {
        type: 'button',
        class: 'btn',
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(url);
            msg.textContent = 'Link copiado.';
          } catch {
            input.focus();
            msg.textContent = 'Não deu para copiar. O link está selecionado: copie manualmente.';
          }
        },
      }, 'Copiar link'),
      msg,
      h('h3', { class: 'sub-title mt' }, 'Como gravar'),
      h('ol', { class: 'pending-list' },
        h('li', {}, 'Instale o app gratuito NFC Tools no celular (Android ou iPhone).'),
        h('li', {}, 'Abra Escrever, toque em Adicionar registro e escolha URL.'),
        h('li', {}, 'Cole o link acima e confirme.'),
        h('li', {}, 'Toque em Escrever e encoste o celular na etiqueta.'),
        h('li', {}, 'Teste: encoste o celular da funcionária na etiqueta. O app deve abrir.'),
        h('li', {}, 'Funcionou? Ligue "Exigir a etiqueta" nos ajustes acima e salve.')),
      h('p', { class: 'field-hint' }, 'Guarde o link só na etiqueta. Se ele vazar, gere um novo código e grave de novo.'),
      rotate,
    );
  }

  api.nfc().then(render).catch((err) => fill(card, h('p', { class: 'alert alert-error', role: 'alert' }, err.message)));
  return card;
}
