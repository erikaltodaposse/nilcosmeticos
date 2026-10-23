// Gráficos simples em SVG, sem biblioteca: colunas e pizza. Cada marca tem <title> para o toque/hover
// e os números aparecem escritos, para ninguém depender só da cor.
import { h } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';

export const CHART_COLORS = {
  good: '#D81B60', // rosa da marca: o que foi feito / bateu a meta
  rest: '#B48A98', // cinza-rosado: o que faltou
  onTime: '#2E7D4F',
  late: '#E07A1F',
};

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

const tip = (text) => svg('title', {}, text);

/** Barra com topo arredondado (4px) e base reta, apoiada no eixo. */
function columnPath(x, y, w, hgt, r = 4) {
  const rr = Math.min(r, w / 2, hgt);
  return `M${x},${y + hgt}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + hgt}Z`;
}

/**
 * Colunas: uma por dia, com a linha da meta tracejada.
 * `items` = [{ label, value, title }]; `meta` = linha de referência.
 */
export function columnChart({ items, meta, ariaLabel }) {
  const W = 340;
  const H = 210;
  const top = 26;
  const bottom = 30;
  const left = 8;
  const right = 8;
  const plotH = H - top - bottom;
  const max = Math.max(meta, ...items.map((i) => i.value), 1);
  const y = (v) => top + plotH - (v / max) * plotH;
  const slot = (W - left - right) / items.length;
  const barW = Math.max(6, Math.min(36, slot - 6));
  const showValues = items.length <= 10;
  const labelEvery = items.length <= 10 ? 1 : Math.ceil(items.length / 8);

  const metaY = y(meta);
  const bars = items.map((item, i) => {
    const x = left + i * slot + (slot - barW) / 2;
    const yTop = y(item.value);
    const hit = item.value >= meta;
    return svg(
      'g',
      {},
      tip(item.title),
      // Área de toque maior que a coluna.
      svg('rect', { x: left + i * slot, y: top, width: slot, height: plotH, fill: 'transparent' }),
      item.value > 0 && svg('path', { d: columnPath(x, yTop, barW, top + plotH - yTop), fill: hit ? CHART_COLORS.good : CHART_COLORS.rest }),
      // Valor em cima da coluna; colado na linha da meta, vai para dentro dela, em branco.
      showValues && (Math.abs(yTop - metaY) < 14 && top + plotH - yTop > 24
        ? svg('text', { x: x + barW / 2, y: yTop + 16, 'text-anchor': 'middle', class: 'chart-value chart-value-in' }, String(item.value))
        : svg('text', { x: x + barW / 2, y: yTop - 6, 'text-anchor': 'middle', class: 'chart-value' }, String(item.value))),
      i % labelEvery === 0 && svg('text', { x: x + barW / 2, y: H - 10, 'text-anchor': 'middle', class: 'chart-axis' }, item.label),
    );
  });

  return svg(
    'svg',
    { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': ariaLabel },
    svg('line', { x1: left, x2: W - right, y1: top + plotH, y2: top + plotH, class: 'chart-base' }),
    bars,
    svg('line', { x1: left, x2: W - right, y1: metaY, y2: metaY, class: 'chart-meta' }),
    svg('text', { x: W - right, y: metaY - 6, 'text-anchor': 'end', class: 'chart-meta-label' }, `Meta ${meta}`),
  );
}

/** Percentuais inteiros que somam 100 (maiores restos), para a legenda não mostrar 88% + 13%. */
export function wholePercents(values) {
  const total = values.reduce((s, v) => s + v, 0);
  if (!total) return values.map(() => 0);
  const raw = values.map((v) => (v / total) * 100);
  const out = raw.map(Math.floor);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < 100 - out.reduce((s, v) => s + v, 0); k++) out[order[k][1]]++;
  return out;
}

/** Pizza de partes de um todo. `parts` = [{ label, value, color }]. */
export function pieChart({ parts, ariaLabel }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const pcts = wholePercents(parts.map((p) => p.value));
  const pctOf = new Map(parts.map((p, i) => [p, pcts[i]]));
  const R = 70;
  const C = 80;
  const shown = parts.filter((p) => p.value > 0);
  let angle = -Math.PI / 2;
  const slices = shown.map((p) => {
    const pct = pctOf.get(p);
    if (shown.length === 1) {
      return svg('g', {}, tip(`${p.label}: ${p.value} (100%)`), svg('circle', { cx: C, cy: C, r: R, fill: p.color }));
    }
    const a0 = angle;
    const a1 = angle + (p.value / total) * Math.PI * 2;
    angle = a1;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const pt = (a) => `${C + R * Math.cos(a)},${C + R * Math.sin(a)}`;
    return svg(
      'g',
      {},
      tip(`${p.label}: ${p.value} (${pct}%)`),
      svg('path', { d: `M${C},${C}L${pt(a0)}A${R},${R} 0 ${large} 1 ${pt(a1)}Z`, fill: p.color, class: 'chart-slice' }),
    );
  });
  const legend = h(
    'ul',
    { class: 'chart-legend' },
    parts.map((p) =>
      h('li', {},
        h('span', { class: 'swatch', style: `background:${p.color}`, 'aria-hidden': 'true' }),
        h('span', {}, p.label),
        h('strong', {}, `${p.value} (${pctOf.get(p)}%)`)),
    ),
  );
  return h(
    'div',
    { class: 'pie-wrap' },
    svg('svg', { viewBox: '0 0 160 160', class: 'pie', role: 'img', 'aria-label': ariaLabel }, slices),
    legend,
  );
}

/** "De cada 10, fez 8": a fração em linguagem de criança. */
export function outOfTen(part, total) {
  if (!total) return null;
  return Math.round((part / total) * 10);
}
