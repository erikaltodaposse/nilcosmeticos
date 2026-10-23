// Texto do resumo do dia para enviar no WhatsApp. Função pura sobre a visão do dia da API.
import { timeKey } from './date.js';

function shortDate(key) {
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
}

export function daySummaryText({ date, storeName, employeeName, day }) {
  const tasks = day.sections.flatMap((s) => s.tasks);
  const pending = tasks.filter((t) => !t.done);
  const hour = (iso) => (iso ? timeKey(new Date(iso)) : 'não registrada');
  const lines = [
    `Resumo do dia — ${storeName}`,
    `${employeeName} · ${shortDate(date)}`,
    '',
    `Entrada: ${hour(day.check_in_at)}`,
    `Saída: ${hour(day.check_out_at)}${day.late_checkout ? ' (depois da tolerância)' : ''}`,
    `Pontos: ${day.points.earned} de ${day.points.meta}`,
    `Tarefas: ${day.points.done} de ${day.points.total}`,
  ];
  if (pending.length) {
    lines.push('', 'Não cumpridas:', ...pending.map((t) => `- ${t.text}`));
  } else {
    lines.push('', 'Todas as tarefas cumpridas.');
  }
  return lines.join('\n');
}

export function whatsappLink(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
