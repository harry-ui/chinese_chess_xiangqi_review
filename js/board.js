// 棋盘视图：用 SVG 绘制棋盘、棋子、高亮和箭头。

import { sqOf, sqX, sqY } from './engine.js';
import { pieceName } from './notation.js';

const NS = 'http://www.w3.org/2000/svg';
const CELL = 60, OX = 40, OY = 52;
const W = OX * 2 + CELL * 8, H = OY * 2 + CELL * 9;
const R = 26;

function el(name, attrs = {}, parent = null) {
  const node = document.createElementNS(NS, name);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(node);
  return node;
}

export class BoardView {
  constructor(svg, onSquare) {
    this.svg = svg;
    this.flipped = false;
    this.pieces = []; // { pc, sq, node }
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = '';
    this.drawStatic();
    this.labelLayer = el('g', { class: 'bd-labels' }, svg);
    this.markLayer = el('g', {}, svg);
    this.pieceLayer = el('g', {}, svg);
    this.arrowLayer = el('g', { 'pointer-events': 'none' }, svg);
    this.drawLabels();

    svg.addEventListener('click', (e) => {
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      const gx = Math.round((p.x - OX) / CELL), gy = Math.round((p.y - OY) / CELL);
      if (gx < 0 || gx > 8 || gy < 0 || gy > 9) return;
      if (Math.hypot(p.x - (OX + gx * CELL), p.y - (OY + gy * CELL)) > CELL * 0.52) return;
      onSquare(this.flipped ? sqOf(8 - gx, 9 - gy) : sqOf(gx, gy));
    });
  }

  xy(sq) {
    let x = sqX(sq), y = sqY(sq);
    if (this.flipped) { x = 8 - x; y = 9 - y; }
    return [OX + x * CELL, OY + y * CELL];
  }

  drawStatic() {
    const svg = this.svg;
    const defs = el('defs', {}, svg);
    const grad = el('radialGradient', { id: 'pieceFill', cx: '38%', cy: '32%', r: '75%' }, defs);
    el('stop', { offset: '0%', 'stop-color': '#fdf0cf' }, grad);
    el('stop', { offset: '70%', 'stop-color': '#eccf95' }, grad);
    el('stop', { offset: '100%', 'stop-color': '#d9b473' }, grad);
    const shadow = el('filter', { id: 'pieceShadow', x: '-30%', y: '-30%', width: '160%', height: '170%' }, defs);
    el('feDropShadow', { dx: 0, dy: 2.5, stdDeviation: 1.8, 'flood-color': '#3b2408', 'flood-opacity': 0.42 }, shadow);

    el('rect', { x: 0, y: 0, width: W, height: H, rx: 10, class: 'bd-bg' }, svg);
    el('rect', { x: OX - 7, y: OY - 7, width: CELL * 8 + 14, height: CELL * 9 + 14, class: 'bd-frame' }, svg);
    const g = el('g', { class: 'bd-lines' }, svg);
    let d = '';
    for (let y = 0; y < 10; y++) d += `M${OX} ${OY + y * CELL}H${OX + 8 * CELL}`;
    for (let x = 0; x < 9; x++) {
      if (x === 0 || x === 8) d += `M${OX + x * CELL} ${OY}V${OY + 9 * CELL}`;
      else d += `M${OX + x * CELL} ${OY}V${OY + 4 * CELL}M${OX + x * CELL} ${OY + 5 * CELL}V${OY + 9 * CELL}`;
    }
    // 九宫斜线
    for (const y0 of [0, 7]) {
      d += `M${OX + 3 * CELL} ${OY + y0 * CELL}L${OX + 5 * CELL} ${OY + (y0 + 2) * CELL}`;
      d += `M${OX + 5 * CELL} ${OY + y0 * CELL}L${OX + 3 * CELL} ${OY + (y0 + 2) * CELL}`;
    }
    // 炮位、兵位的折角标记
    const marks = [[1, 2], [7, 2], [1, 7], [7, 7]];
    for (let x = 0; x <= 8; x += 2) marks.push([x, 3], [x, 6]);
    for (const [x, y] of marks) {
      const cx = OX + x * CELL, cy = OY + y * CELL, a = 5, b = 14;
      for (const sx of [-1, 1]) {
        if ((x === 0 && sx === -1) || (x === 8 && sx === 1)) continue;
        for (const sy of [-1, 1]) {
          d += `M${cx + sx * a} ${cy + sy * b}V${cy + sy * a}H${cx + sx * b}`;
        }
      }
    }
    el('path', { d, fill: 'none' }, g);
    const river = el('g', { class: 'bd-river' }, svg);
    const ry = OY + 4.5 * CELL;
    el('text', { x: OX + 2 * CELL, y: ry, dy: '.36em', 'text-anchor': 'middle' }, river).textContent = '楚 河';
    el('text', { x: OX + 6 * CELL, y: ry, dy: '.36em', 'text-anchor': 'middle' }, river).textContent = '汉 界';
  }

  drawLabels() {
    this.labelLayer.innerHTML = '';
    const top = this.flipped ? '九八七六五四三二一' : '１２３４５６７８９';
    const bottom = this.flipped ? '１２３４５６７８９' : '九八七六五四三二一';
    for (let i = 0; i < 9; i++) {
      // 黑方纵线从黑方右手数起；翻转后红方在上
      const t = this.flipped ? top[8 - i] : top[i];
      const b = this.flipped ? bottom[8 - i] : bottom[i];
      el('text', { x: OX + i * CELL, y: 18, 'text-anchor': 'middle' }, this.labelLayer).textContent = t;
      el('text', { x: OX + i * CELL, y: H - 8, 'text-anchor': 'middle' }, this.labelLayer).textContent = b;
    }
  }

  setFlipped(flipped) {
    if (this.flipped === flipped) return;
    this.flipped = flipped;
    this.drawLabels();
    for (const p of this.pieces) this.place(p, false);
  }

  place(p, animate) {
    const [x, y] = this.xy(p.sq);
    p.node.style.transition = animate ? '' : 'none';
    p.node.style.transform = `translate(${x}px, ${y}px)`;
    if (!animate) {
      p.node.getBoundingClientRect(); // 强制生效，之后再恢复过渡
      p.node.style.transition = '';
    }
  }

  createPiece(pc, sq) {
    const node = el('g', { class: 'piece ' + (pc < 16 ? 'red' : 'black') });
    el('circle', { r: R, class: 'pc-body', fill: 'url(#pieceFill)', filter: 'url(#pieceShadow)' }, node);
    el('circle', { r: R - 5, class: 'pc-ring' }, node);
    el('text', { 'text-anchor': 'middle', dy: '.35em', class: 'pc-text' }, node).textContent = pieceName(pc);
    const p = { pc, sq, node };
    this.place(p, false);
    this.pieceLayer.appendChild(node);
    return p;
  }

  // 同步到新的局面。尽量复用已有棋子节点，这样走子、悔棋、翻看时都有移动动画。
  setPosition(board, animate = true) {
    const wanted = new Map();
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 9; x++) {
        const sq = sqOf(x, y);
        if (board[sq]) wanted.set(sq, board[sq]);
      }
    }
    const keep = [], free = [];
    for (const p of this.pieces) {
      if (wanted.get(p.sq) === p.pc) {
        keep.push(p);
        wanted.delete(p.sq);
      } else {
        free.push(p);
      }
    }
    for (const [sq, pc] of wanted) {
      let bi = -1, bd = Infinity;
      for (let i = 0; i < free.length; i++) {
        if (free[i].pc !== pc) continue;
        const dist = Math.abs(sqX(free[i].sq) - sqX(sq)) + Math.abs(sqY(free[i].sq) - sqY(sq));
        if (dist < bd) { bd = dist; bi = i; }
      }
      if (bi >= 0) {
        const p = free.splice(bi, 1)[0];
        p.sq = sq;
        this.pieceLayer.appendChild(p.node); // 移动中的棋子压在最上面
        this.place(p, animate);
        keep.push(p);
      } else {
        keep.push(this.createPiece(pc, sq));
      }
    }
    for (const p of free) {
      const node = p.node;
      if (animate) {
        node.classList.add('leaving');
        setTimeout(() => node.remove(), 220);
      } else {
        node.remove();
      }
    }
    this.pieces = keep;
  }

  // marks: { last: [src, dst], selected: sq, targets: [{sq, capture}], check: sq }
  setMarks(marks = {}) {
    const layer = this.markLayer;
    layer.innerHTML = '';
    const corner = (sq, cls) => {
      const [x, y] = this.xy(sq);
      const a = R + 2, b = 10;
      let d = '';
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) d += `M${x + sx * a} ${y + sy * (a - b)}V${y + sy * a}H${x + sx * (a - b)}`;
      el('path', { d, class: cls, fill: 'none' }, layer);
    };
    if (marks.last) {
      const [x, y] = this.xy(marks.last[0]);
      el('circle', { cx: x, cy: y, r: 7, class: 'mk-from' }, layer);
      corner(marks.last[1], 'mk-last');
    }
    if (marks.check) {
      const [x, y] = this.xy(marks.check);
      el('circle', { cx: x, cy: y, r: R + 5, class: 'mk-check' }, layer);
    }
    if (marks.selected) corner(marks.selected, 'mk-selected');
    this.arrowLayer.querySelectorAll('.mk-target').forEach((n) => n.remove());
    for (const t of marks.targets || []) {
      const [x, y] = this.xy(t.sq);
      el('circle', { cx: x, cy: y, r: t.capture ? R + 3 : 8, class: 'mk-target' + (t.capture ? ' capture' : '') }, this.arrowLayer);
    }
  }

  // arrows: [{ mv, color, dashed }]
  setArrows(arrows = []) {
    this.arrowLayer.querySelectorAll('.arrow').forEach((n) => n.remove());
    for (const a of arrows) {
      const [x1, y1] = this.xy(a.mv & 255);
      const [x2, y2] = this.xy(a.mv >> 8);
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (!len) continue;
      const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
      const head = 20, half = 11, start = 14, end = len - 6;
      const bx = x1 + ux * (end - head), by = y1 + uy * (end - head);
      const g = el('g', { class: 'arrow', opacity: a.opacity || 0.9 }, this.arrowLayer);
      el('line', {
        x1: x1 + ux * start, y1: y1 + uy * start, x2: bx, y2: by,
        stroke: a.color, 'stroke-width': 8, 'stroke-linecap': 'round',
        ...(a.dashed ? { 'stroke-dasharray': '4 12' } : {}),
      }, g);
      el('polygon', {
        points: `${x1 + ux * end},${y1 + uy * end} ${bx - uy * half},${by + ux * half} ${bx + uy * half},${by - ux * half}`,
        fill: a.color,
      }, g);
    }
  }
}
