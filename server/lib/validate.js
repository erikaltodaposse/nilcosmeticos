// Validação das entradas da gestora. Cada função devolve { value } ou { error } com mensagem em português.

const AUTO_KINDS = ['check_in', 'check_out', 'close'];
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function text(value, { max, required = true }) {
  if (value == null || value === '') return required ? null : '';
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if ((required && !trimmed) || trimmed.length > max) return null;
  return trimmed;
}

function int(value, min, max) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** Template do checklist vindo do editor. */
export function parseChecklist(body) {
  if (!body || typeof body !== 'object') return { error: 'Envie o checklist.' };
  const focus = text(body.cleaning_focus, { max: 120, required: false });
  if (focus === null) return { error: 'O foco de limpeza tem no máximo 120 caracteres.' };
  if (!Array.isArray(body.sections) || body.sections.length === 0 || body.sections.length > 20) {
    return { error: 'O checklist precisa ter de 1 a 20 blocos.' };
  }
  const seenAuto = new Set();
  const sections = [];
  for (const [i, raw] of body.sections.entries()) {
    const title = text(raw?.title, { max: 60 });
    if (!title) return { error: `Dê um nome ao bloco ${i + 1} (até 60 caracteres).` };
    const subtitle = text(raw.subtitle, { max: 120, required: false });
    if (subtitle === null) return { error: `O subtítulo do bloco "${title}" tem no máximo 120 caracteres.` };
    if (!Array.isArray(raw.tasks) || raw.tasks.length > 50) {
      return { error: `O bloco "${title}" aceita até 50 tarefas.` };
    }
    const tasks = [];
    for (const [j, t] of raw.tasks.entries()) {
      const where = `tarefa ${j + 1} do bloco "${title}"`;
      const taskText = text(t?.text, { max: 200 });
      if (!taskText) return { error: `Escreva o texto da ${where} (até 200 caracteres).` };
      const points = int(t.points, 0, 1000);
      if (points === null) return { error: `Os pontos da ${where} precisam ser um número inteiro de 0 a 1000.` };
      const postSlot = t.post_slot == null || t.post_slot === '' ? null : int(t.post_slot, 1, 3);
      if (postSlot === null && !(t.post_slot == null || t.post_slot === '')) {
        return { error: `O horário de post da ${where} precisa ser 1, 2 ou 3.` };
      }
      const auto = t.auto == null || t.auto === '' ? null : t.auto;
      if (auto !== null && !AUTO_KINDS.includes(auto)) return { error: `Tipo automático inválido na ${where}.` };
      if (auto && seenAuto.has(auto)) return { error: 'Cada tarefa automática (entrada, saída, fechamento) só pode aparecer uma vez.' };
      if (auto) seenAuto.add(auto);
      tasks.push({ text: taskText, points, requires_photo: Boolean(t.requires_photo), post_slot: postSlot, auto });
    }
    sections.push({ title, subtitle: subtitle || null, tasks });
  }
  if (!sections.some((s) => s.tasks.length > 0)) return { error: 'O checklist precisa ter pelo menos uma tarefa.' };
  return { value: { cleaning_focus: focus || null, sections } };
}

export function parseWeekdayList(value) {
  if (value == null) return { value: [] };
  if (!Array.isArray(value) || value.some((d) => int(d, 0, 6) === null)) return { error: 'Dias da semana inválidos.' };
  return { value: [...new Set(value.map(Number))].sort() };
}

/** Configurações editáveis. Só as chaves enviadas são alteradas. */
export function parseSettings(body) {
  if (!body || typeof body !== 'object') return { error: 'Envie as configurações.' };
  const out = {};
  if ('meta_pontos' in body) {
    const v = int(body.meta_pontos, 1, 10000);
    if (v === null) return { error: 'A meta diária precisa ser um número inteiro de 1 a 10000.' };
    out.meta_pontos = String(v);
  }
  for (const key of ['turno_inicio', 'turno_fim']) {
    if (key in body) {
      if (typeof body[key] !== 'string' || !HHMM_RE.test(body[key])) return { error: 'Use horários no formato HH:MM.' };
      out[key] = body[key];
    }
  }
  if (out.turno_inicio && out.turno_fim && out.turno_inicio >= out.turno_fim) {
    return { error: 'O fim do turno precisa ser depois do início.' };
  }
  if ('bonus_base' in body) {
    const n = typeof body.bonus_base === 'string' ? Number(body.bonus_base.replace(',', '.')) : body.bonus_base;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1e6) {
      return { error: 'O bônus-base precisa ser um valor de 0 a 1.000.000.' };
    }
    out.bonus_base = String(Math.round(n * 100) / 100);
  }
  if ('nome_loja' in body) {
    const v = text(body.nome_loja, { max: 80 });
    if (!v) return { error: 'O nome da loja precisa ter de 1 a 80 caracteres.' };
    out.nome_loja = v;
  }
  if ('dias_expediente' in body) {
    const days = parseWeekdayList(body.dias_expediente);
    if (days.error) return days;
    out.dias_expediente = days.value.join(',');
  }
  return { value: out };
}

/** Um post do roteiro. */
export function parsePost(body) {
  if (!body || typeof body !== 'object') return { error: 'Envie o post.' };
  const weekday = int(body.weekday, 0, 6);
  if (weekday === null) return { error: 'Escolha o dia da semana.' };
  const slot = int(body.slot, 1, 3);
  if (slot === null) return { error: 'Escolha o horário (1, 2 ou 3).' };
  const fields = { channel: 60, product_line: 80, hook: 300, caption: 2000, cta: 300 };
  const out = { weekday, slot };
  for (const [key, max] of Object.entries(fields)) {
    const v = text(body[key], { max, required: false });
    if (v === null) return { error: `O campo ${key} tem no máximo ${max} caracteres.` };
    out[key] = v || null;
  }
  if (!out.hook && !out.caption) return { error: 'Preencha pelo menos o gancho ou a legenda.' };
  return { value: out };
}
