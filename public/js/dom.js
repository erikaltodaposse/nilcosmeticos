// Pequenos utilitários de DOM. Textos sempre via textContent, nunca innerHTML com dado do usuário.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  return appendChildren(el, children);
}

function appendChildren(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === '') continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Troca o conteúdo de um elemento, ignorando filhos vazios (null, false) como h(). */
export function fill(el, ...children) {
  el.replaceChildren();
  return appendChildren(el, children);
}

export function showError(box, message) {
  box.textContent = message;
  box.hidden = !message;
}

/** Desabilita o botão enquanto a ação roda, para evitar duplo envio. */
export async function busy(button, label, fn) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}
