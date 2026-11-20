// 页面主控：对弈流程、复盘流程和界面渲染。

import { Position, RED, BLACK, START_FEN, moveToIccs, iccsToMove, positionFromMoves } from './engine.js';
import { moveToChinese, lineToChinese } from './notation.js';
import { bookMove } from './book.js';
import { BoardView } from './board.js';
import { CLASSES, CLASS_ORDER, classify, explain, summarize, formatScore, winProb } from './review.js';
import { PikafishPool, PIKAFISH_BYTES } from './pikafish.js';

const LEVELS = [
  { id: 1, name: '新手', random: { depth: 1, margin: 150 } },
  { id: 2, name: '入门', random: { depth: 2, margin: 60 } },
  { id: 3, name: '业余', timeMs: 300, maxDepth: 4 },
  { id: 4, name: '棋手', timeMs: 1000, maxDepth: 8 },
  { id: 5, name: '大师', timeMs: 3000, maxDepth: 60 },
  { id: 6, name: '皮卡鱼（极强）', pikafish: { timeMs: 1000 } },
];
// 复盘用的引擎和每步思考时间。皮卡鱼强得多，内置引擎不用下载
const ANALYSIS = [
  { id: 'pikafish:fast', name: '皮卡鱼 · 快速', engine: 'pikafish', timeMs: 250 },
  { id: 'pikafish:normal', name: '皮卡鱼 · 标准', engine: 'pikafish', timeMs: 600 },
  { id: 'pikafish:deep', name: '皮卡鱼 · 深入', engine: 'pikafish', timeMs: 1500 },
  { id: 'builtin:normal', name: '内置引擎', engine: 'builtin', timeMs: 1000 },
];
const ENGINE_NAME = { pikafish: '皮卡鱼', builtin: '内置引擎' };
const SIDE_NAME = ['红方', '黑方'];
const SAVE_KEY = 'xiangqi-review:game';
const PREFS_KEY = 'xiangqi-review:prefs';
const HINT_COLOR = '#1f6fd0', BEST_COLOR = '#2f9e61', NEUTRAL_COLOR = '#6b6b6b';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 无痕模式等情况下忽略 */ } },
};

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------

const game = { playerSide: RED, level: 3, moves: [], texts: [], result: null };
let pos = new Position();
let mode = 'play';
let selected = 0, targets = [];
let thinking = false, hint = null, hintPending = false;
let engine = null, reqId = 0, pending = null;

const prefs = store.get(PREFS_KEY) || {};
const review = {
  items: [], cursor: 0, done: 0, total: 0, pool: null, token: 0,
  option: ANALYSIS.some((a) => a.id === prefs.analysis) ? prefs.analysis : 'pikafish:normal',
  engine: 'pikafish', // 这次复盘实际用的引擎
  notice: '',
};

const pika = new PikafishPool();
let pikaLoad = null; // 正在下载引擎文件时为 { done, total }

const board = new BoardView($('board'), onSquare);

// ---------------------------------------------------------------------------
// 引擎线程
// ---------------------------------------------------------------------------

function createWorker() {
  return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
}

function startEngine() {
  if (engine) engine.terminate();
  engine = createWorker();
  engine.onmessage = (e) => {
    const msg = e.data;
    if (msg.type !== 'play' || !pending || msg.id !== pending.id) return;
    const done = pending.done;
    pending = null;
    done(msg);
  };
  engine.onerror = () => showNotice('引擎线程加载失败。请通过 http(s) 地址访问本页面（例如 GitHub Pages 或本地 http 服务），不要直接双击打开 html 文件。');
}

function showNotice(text) {
  const n = $('notice');
  n.textContent = text;
  n.hidden = false;
}

function currentLevel() {
  return LEVELS.find((l) => l.id === game.level) || LEVELS[2];
}

function levelConfig(lv = currentLevel()) {
  if (lv.pikafish) lv = LEVELS[4]; // 皮卡鱼不可用时退回内置引擎的最高档
  return lv.random ? { random: lv.random } : { timeMs: lv.timeMs, maxDepth: lv.maxDepth };
}

// 确保皮卡鱼引擎已加载（首次需要下载约 13 MB）
function ensurePika(n) {
  if (!pikaLoad && !pika.ready) pikaLoad = { done: 0, total: PIKAFISH_BYTES };
  let lastPaint = 0;
  return pika.ensure(n, (done, total) => {
    pikaLoad = { done, total };
    if (performance.now() - lastPaint < 120 && done < total) return;
    lastPaint = performance.now();
    paintPikaLoad();
  }).finally(() => { pikaLoad = null; });
}

function pikaLoadText() {
  const pct = pikaLoad ? Math.min(100, Math.round((pikaLoad.done / pikaLoad.total) * 100)) : 100;
  return `正在下载皮卡鱼引擎（约 13 MB，仅首次）… ${pct}%`;
}

function paintPikaLoad() {
  if (!pikaLoad) return;
  for (const n of document.querySelectorAll('[data-pika-text]')) n.textContent = pikaLoadText();
  for (const n of document.querySelectorAll('[data-pika-bar]')) n.style.width = Math.min(100, (pikaLoad.done / pikaLoad.total) * 100).toFixed(1) + '%';
}

function cancelSearch() {
  reqId++;
  hintPending = false;
  pika.cancel();
  if (pending) {
    pending = null;
    startEngine(); // 正在算的那一步直接丢弃
  }
  thinking = false;
}

function aiTurn() {
  if (game.result || pos.side === game.playerSide || mode !== 'play') return;
  thinking = true;
  renderStatus();
  renderSeats();
  renderButtons();
  const id = ++reqId;
  const started = performance.now();
  const deliver = (mv) => {
    // 走得太快看不清，至少停顿一下
    setTimeout(() => {
      if (id !== reqId) return;
      thinking = false;
      if (mv && pos.isLegal(mv)) playMove(mv);
      else render();
    }, Math.max(0, 420 - (performance.now() - started)));
  };
  const book = bookMove(game.moves);
  if (book && pos.isLegal(book)) return deliver(book);
  const builtin = () => {
    if (id !== reqId) return;
    pending = { id, done: (msg) => deliver(msg.move) };
    engine.postMessage({ type: 'play', id, fen: START_FEN, moves: game.moves, ...levelConfig() });
  };
  const lv = currentLevel();
  if (!lv.pikafish) return builtin();
  const moves = game.moves.slice();
  const loading = ensurePika(1);
  renderStatus(); // 需要下载时显示进度
  loading
    .then(() => {
      if (id !== reqId) return null;
      renderStatus();
      return pika.play(START_FEN, moves, lv.pikafish.timeMs);
    })
    .then((res) => { if (res && id === reqId) deliver(res.move); })
    .catch(() => {
      showNotice('皮卡鱼引擎加载失败，这一步改由内置引擎（大师档）来走。');
      builtin();
    });
}

function requestHint() {
  if (game.result || thinking || hintPending || pos.side !== game.playerSide) return;
  const id = ++reqId;
  hintPending = true;
  renderStatus();
  renderButtons();
  const done = (msg) => {
    if (id !== reqId) return;
    hintPending = false;
    if (!msg || !msg.move) return render();
    hint = { move: msg.move, text: moveToChinese(pos, msg.move) };
    render();
  };
  // 皮卡鱼已经加载好就用它，和复盘时的判断保持一致；否则用内置引擎，不为一个提示去下载
  if (pika.ready) {
    pika.play(START_FEN, game.moves.slice(), 700).then(done, () => done(null));
    return;
  }
  pending = { id, done };
  engine.postMessage({ type: 'play', id, fen: START_FEN, moves: game.moves, timeMs: 900, maxDepth: 60 });
}

// ---------------------------------------------------------------------------
// 对弈
// ---------------------------------------------------------------------------

function judge(p) {
  if (!p.hasLegalMove()) return { winner: 1 - p.side, reason: p.inCheck() ? '将死' : '困毙' };
  const rep = p.repStatus(2);
  if (rep) {
    const self = (rep & 2) !== 0, opp = (rep & 4) !== 0;
    if (self && !opp) return { winner: 1 - p.side, reason: '长将违例' };
    if (opp && !self) return { winner: p.side, reason: '长将违例' };
    return { winner: null, reason: '三次重复局面' };
  }
  if (p.pliesSinceCapture() >= 120) return { winner: null, reason: '六十回合无吃子' };
  if (p.noAttackers()) return { winner: null, reason: '双方都没有进攻子力' };
  return null;
}

function playMove(mv) {
  game.texts.push(moveToChinese(pos, mv));
  pos.makeMove(mv);
  game.moves.push(mv);
  selected = 0;
  targets = [];
  hint = null;
  game.result = judge(pos);
  save();
  render();
  if (!game.result) aiTurn();
}

function onSquare(sq) {
  if (mode !== 'play' || game.result || thinking || pos.side !== game.playerSide) return;
  const pc = pos.sq[sq];
  const own = pc !== 0 && (pc < 16 ? RED : BLACK) === game.playerSide;
  if (selected && targets.some((t) => t.sq === sq)) {
    cancelHintOnly();
    return playMove(selected | (sq << 8));
  }
  if (own && sq !== selected) {
    selected = sq;
    targets = pos.legalMoves().filter((mv) => (mv & 255) === sq).map((mv) => ({ sq: mv >> 8, capture: pos.sq[mv >> 8] !== 0 }));
  } else {
    selected = 0;
    targets = [];
  }
  renderBoard();
}

function cancelHintOnly() {
  if (hintPending) {
    hintPending = false;
    reqId++;
    pika.cancel();
    // 引擎还在算提示：这次结果作废，但不必重启线程，下一条请求会排在后面
    pending = null;
  }
}

function newGame() {
  cancelSearch();
  leaveReview();
  game.playerSide = +$('selSide').value;
  game.level = +$('selLevel').value;
  game.moves = [];
  game.texts = [];
  game.result = null;
  pos = new Position();
  selected = 0;
  targets = [];
  hint = null;
  save();
  render();
  aiTurn();
}

function undo() {
  if (mode !== 'play' || game.moves.length === 0) return;
  cancelSearch();
  game.result = null;
  const pop = () => {
    pos.undoMakeMove();
    game.moves.pop();
    game.texts.pop();
  };
  pop();
  if (pos.side !== game.playerSide && game.moves.length > 0) pop();
  selected = 0;
  targets = [];
  hint = null;
  save();
  render();
  aiTurn(); // 执黑且退回到开局时，轮到 AI 先走
}

function resign() {
  if (game.result || mode !== 'play') return;
  if (!window.confirm('确定认输吗？认输后可以复盘这一局。')) return;
  cancelSearch();
  game.result = { winner: 1 - game.playerSide, reason: '认输' };
  save();
  render();
}

function save() {
  store.set(SAVE_KEY, {
    v: 1, side: game.playerSide, level: game.level, moves: game.moves.map(moveToIccs), result: game.result,
  });
}

function restore() {
  const data = store.get(SAVE_KEY);
  if (!data || data.v !== 1 || !Array.isArray(data.moves)) return false;
  try {
    const p = new Position();
    const moves = [], texts = [];
    for (const s of data.moves) {
      const mv = iccsToMove(s);
      if (!p.isLegal(mv)) return false;
      texts.push(moveToChinese(p, mv));
      p.makeMove(mv);
      moves.push(mv);
    }
    game.playerSide = data.side === BLACK ? BLACK : RED;
    game.level = LEVELS.some((l) => l.id === data.level) ? data.level : 3;
    game.moves = moves;
    game.texts = texts;
    game.result = data.result || judge(p);
    pos = p;
    return true;
  } catch {
    return false;
  }
}

function resultTitle() {
  const r = game.result;
  if (!r) return '';
  if (r.winner === null) return '和棋';
  return r.winner === game.playerSide ? '你赢了' : '你输了';
}

function userPlies() {
  const list = [];
  for (let i = game.playerSide === RED ? 0 : 1; i < game.moves.length; i += 2) list.push(i);
  return list;
}

// ---------------------------------------------------------------------------
// 复盘
// ---------------------------------------------------------------------------

class AnalysisPool {
  constructor(size, onResult) {
    this.queue = [];
    this.workers = [];
    for (let i = 0; i < size; i++) {
      const w = createWorker();
      w.busy = false;
      w.onmessage = (e) => {
        if (e.data.type !== 'analyze') return;
        w.busy = false;
        onResult(e.data);
        this.pump();
      };
      this.workers.push(w);
    }
  }

  run(tasks) {
    this.queue.push(...tasks);
    this.pump();
  }

  pump() {
    for (const w of this.workers) {
      if (!w.busy && this.queue.length) {
        w.busy = true;
        w.postMessage(this.queue.shift());
      }
    }
  }

  destroy() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.queue = [];
  }
}

function startReview() {
  if (!game.result) return;
  cancelSearch();
  mode = 'review';
  const plies = userPlies();
  review.cursor = plies.length ? plies[0] : game.moves.length;
  runAnalysis();
  render();
}

function analysisOption() {
  return ANALYSIS.find((a) => a.id === review.option) || ANALYSIS[1];
}

async function runAnalysis() {
  if (review.pool) review.pool.destroy();
  review.pool = null;
  pika.cancel();
  const token = ++review.token;
  const plies = userPlies();
  const opt = analysisOption();
  review.items = new Array(game.moves.length).fill(null);
  review.done = 0;
  review.total = plies.length;
  review.engine = opt.engine;
  review.notice = '';
  if (!plies.length) return;
  const tasks = plies.map((ply) => ({
    ply, fen: START_FEN, moves: game.moves.slice(0, ply), played: game.moves[ply], timeMs: opt.timeMs,
  }));

  if (opt.engine === 'pikafish') {
    // 每个引擎线程要占两百多 MB 内存：手机上只开一个，电脑上最多三个
    const small = window.matchMedia('(max-width: 900px)').matches || (navigator.deviceMemory || 8) <= 4;
    const size = small ? 1 : Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1, plies.length));
    try {
      await ensurePika(size);
    } catch (err) {
      console.warn('Pikafish unavailable, falling back to the built-in engine:', err);
    }
    if (token !== review.token) return;
    if (pika.ready) {
      pika.newGame();
      renderReview();
      for (const task of tasks) {
        pika.analyze(task).then((res) => {
          if (res && token === review.token) onAnalysis({ ply: task.ply, ...res });
        }, (err) => {
          if (token !== review.token) return;
          console.warn('Pikafish analysis failed:', err);
          review.notice = '皮卡鱼引擎中途出错，有些着法没能分析。可以换成内置引擎再试一次。';
          renderReview();
        });
      }
      return;
    }
    review.engine = 'builtin';
    review.notice = '皮卡鱼引擎加载失败，这次改用内置引擎分析（棋力较弱）。';
    renderReview();
  }

  const size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1, plies.length));
  review.pool = new AnalysisPool(size, (msg) => {
    if (msg.id === token) onAnalysis(msg);
  });
  review.pool.run(tasks.map((t) => ({ type: 'analyze', id: token, ...t, timeMs: analysisOption().engine === 'builtin' ? t.timeMs : 1000 })));
}

function onAnalysis(msg) {
  const ply = msg.ply;
  const move = game.moves[ply];
  const p = positionFromMoves(START_FEN, game.moves.slice(0, ply));
  const { cls, loss } = classify(msg.best.score, msg.played.score, msg.best.move === move);
  const item = { ply, move, cls, loss, best: msg.best, played: msg.played };
  item.text = explain(p, item);
  item.bestText = moveToChinese(p, msg.best.move);
  item.bestLine = lineToChinese(p, msg.best.pv, 7);
  item.playedLine = lineToChinese(p, msg.played.pv, 7);
  review.items[ply] = item;
  review.done++;
  if (review.done === review.total && review.pool) {
    review.pool.destroy();
    review.pool = null;
  }
  renderReview();
  if (ply === review.cursor) renderBoard();
}

function leaveReview() {
  if (review.pool) review.pool.destroy();
  review.pool = null;
  pika.cancel();
  review.token++;
  mode = 'play';
}

function setCursor(ply, fromList = false) {
  review.cursor = Math.max(0, Math.min(game.moves.length, ply));
  renderBoard();
  renderReview();
  if (fromList) {
    // 小屏上棋谱在棋盘下方：点了某一步后把棋盘带回视野
    if ($('board').getBoundingClientRect().top < 0) document.querySelector('.stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const list = $('reviewMoves');
  const cur = list.querySelector('.mv.current');
  if (cur) {
    // 只滚动棋谱容器本身，不带动整个页面
    const top = cur.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + cur.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + cur.offsetHeight - list.clientHeight;
  }
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

function render() {
  $('playPanel').hidden = mode !== 'play';
  $('reviewPanel').hidden = mode !== 'review';
  $('nav').hidden = mode !== 'review';
  $('selSide').value = String(game.playerSide);
  $('selLevel').value = String(game.level);
  renderBoard();
  renderSeats();
  if (mode === 'play') {
    renderStatus();
    renderButtons();
    renderMoves($('moveList'), false);
  } else {
    renderReview();
  }
}

function renderBoard() {
  board.setFlipped(game.playerSide === BLACK);
  if (mode === 'play') {
    board.setPosition(pos.sq);
    const n = game.moves.length;
    board.setMarks({
      last: n ? [game.moves[n - 1] & 255, game.moves[n - 1] >> 8] : null,
      selected,
      targets,
      check: !game.result && pos.inCheck() ? pos.kingSq[pos.side] : 0,
    });
    board.setArrows(hint ? [{ mv: hint.move, color: HINT_COLOR }] : []);
    return;
  }
  // 复盘：显示“走这一步之前”的局面，用箭头标出实战着法和推荐着法
  const k = review.cursor, n = game.moves.length;
  const p = positionFromMoves(START_FEN, game.moves.slice(0, k));
  board.setPosition(p.sq);
  if (k >= n) {
    board.setMarks({ last: n ? [game.moves[n - 1] & 255, game.moves[n - 1] >> 8] : null });
    board.setArrows([]);
    return;
  }
  board.setMarks({ check: p.inCheck() ? p.kingSq[p.side] : 0 });
  const item = review.items[k];
  const arrows = [];
  if (item && item.best.move !== item.move) arrows.push({ mv: item.best.move, color: BEST_COLOR });
  arrows.push({ mv: game.moves[k], color: item ? CLASSES[item.cls].color : NEUTRAL_COLOR, opacity: item ? 0.92 : 0.75 });
  board.setArrows(arrows);
}

function renderSeats() {
  const ai = 1 - game.playerSide;
  const lv = currentLevel();
  const turn = mode === 'play' && !game.result ? pos.side : -1;
  const seat = (side, name, sub, state) => `
    <span class="avatar ${side === RED ? 'red' : 'black'}">${side === RED ? '帅' : '将'}</span>
    <span class="seat-name">${name}</span><span class="seat-sub">${sub}</span>
    <span class="seat-state">${state}</span>`;
  $('seatTop').innerHTML = seat(ai, 'AI', `${SIDE_NAME[ai]} · ${lv.name.replace(/（.*）/, '')}`,
    turn === ai ? '<i class="dot pulse"></i>思考中…' : '');
  $('seatBottom').innerHTML = seat(game.playerSide, '你', SIDE_NAME[game.playerSide],
    turn === game.playerSide ? '<i class="dot"></i>轮到你走' : '');
}

function renderStatus() {
  const card = $('statusCard');
  if (game.result) {
    const r = game.result;
    const cls = r.winner === null ? '' : r.winner === game.playerSide ? 'result-win' : 'result-lose';
    const rounds = Math.ceil(game.moves.length / 2);
    const canReview = userPlies().length > 0;
    card.innerHTML = `
      <div class="status-title ${cls}">${resultTitle()} · ${esc(r.reason)}</div>
      <div class="status-sub">共 ${rounds} 回合。${canReview ? '想知道每一步下得怎么样？' : '这一局你还没有走棋，没有可复盘的内容。'}</div>
      <div class="status-actions">
        <button type="button" class="primary" data-act="review" ${canReview ? '' : 'disabled'}>复盘这一局</button>
        <button type="button" data-act="new">再来一局</button>
      </div>`;
    return;
  }
  let title, sub;
  if (thinking && pikaLoad) {
    title = '正在准备皮卡鱼引擎…';
    sub = `<span data-pika-text>${pikaLoadText()}</span>`;
  } else if (thinking) {
    title = 'AI 正在思考…';
    sub = '可以先想想下一步怎么走。';
  } else if (hintPending) {
    title = '正在计算提示…';
    sub = '';
  } else {
    title = `轮到你走（${SIDE_NAME[game.playerSide]}）`;
    sub = hint ? `提示：<b>${esc(hint.text)}</b>（见棋盘上的蓝色箭头）`
      : pos.inCheck() ? '你被将军了，必须应将。'
      : game.moves.length < 2 ? '点击棋子，再点击落点。下完后可以逐步复盘。' : '点击棋子，再点击落点。';
  }
  card.innerHTML = `<div class="status-title">${title}</div><div class="status-sub">${sub}</div>`;
}

function renderButtons() {
  const myTurn = !game.result && !thinking && pos.side === game.playerSide;
  const userMoved = userPlies().length > 0;
  $('btnUndo').disabled = !userMoved && !game.result;
  $('btnHint').disabled = !myTurn || hintPending;
  $('btnResign').disabled = !!game.result;
}

function tagHtml(item, pendingTag) {
  if (item) return `<span class="tag" style="--c:${CLASSES[item.cls].color}" title="${CLASSES[item.cls].label}">${CLASSES[item.cls].symbol}</span>`;
  return pendingTag ? '<span class="tag pending">…</span>' : '';
}

function renderMoves(container, inReview) {
  const n = game.moves.length;
  if (!n) {
    container.innerHTML = '<div class="moves-empty">还没有走棋。</div>';
    return;
  }
  let html = '';
  for (let i = 0; i < n; i += 2) {
    html += `<div class="mv-row"><span class="mv-no">${i / 2 + 1}.</span>`;
    for (let j = i; j < i + 2; j++) {
      if (j >= n) { html += '<span></span>'; continue; }
      const mine = (j % 2 === 0 ? RED : BLACK) === game.playerSide;
      const cls = ['mv', j % 2 === 0 ? 'red' : 'black'];
      if (inReview && j === review.cursor) cls.push('current');
      if (!inReview && j === n - 1) cls.push('last');
      html += `<button type="button" class="${cls.join(' ')}" data-ply="${j}" ${inReview ? '' : 'disabled'}>
        <span>${esc(game.texts[j])}</span>${inReview && mine ? tagHtml(review.items[j], true) : ''}</button>`;
    }
    html += '</div>';
  }
  const keepScroll = container.scrollTop;
  container.innerHTML = html;
  if (inReview) container.scrollTop = keepScroll;
  else container.scrollTop = container.scrollHeight;
}

// 每个局面下“你的胜率”，用于画走势图
function winCurve() {
  const n = game.moves.length;
  const w = new Array(n + 1).fill(null);
  for (const it of review.items) {
    if (!it) continue;
    w[it.ply] = winProb(it.best.score);
    w[it.ply + 1] = winProb(it.played.score);
  }
  const r = game.result;
  if (r && r.reason !== '认输' && review.done === review.total) {
    w[n] = r.winner === null ? 0.5 : r.winner === game.playerSide ? 1 : 0;
  }
  let last = 0.5;
  for (let i = 0; i <= n; i++) {
    if (w[i] === null) w[i] = last;
    last = w[i];
  }
  return w;
}

function chartSvg() {
  const W = 360, H = 96;
  const w = winCurve();
  const n = w.length - 1;
  const x = (i) => (n ? (i / n) * W : 0);
  const y = (v) => (1 - v) * H;
  let line = '';
  w.forEach((v, i) => { line += `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`; });
  let dots = '';
  for (const it of review.items) {
    if (!it || it.cls === 'best' || it.cls === 'good') continue;
    dots += `<circle cx="${x(it.ply + 1).toFixed(1)}" cy="${y(w[it.ply + 1]).toFixed(1)}" r="3.6" fill="${CLASSES[it.cls].color}" stroke="#fff" stroke-width="1"/>`;
  }
  const cx = x(Math.min(review.cursor, n)).toFixed(1);
  return `<svg id="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="胜率走势图">
    <path d="${line}L${W} ${H}L0 ${H}Z" fill="#f6e7c6"/>
    <path d="M0 ${H / 2}H${W}" stroke="rgba(120,90,60,.55)" stroke-width="1" stroke-dasharray="4 4"/>
    <path d="${line}" fill="none" stroke="#a3271c" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
    ${dots}
    <path d="M${cx} 0V${H}" stroke="#1f6fd0" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

function renderReview() {
  if (mode !== 'review') return;
  const n = game.moves.length;
  const k = review.cursor;
  $('navPos').textContent = k >= n ? '终局' : `第 ${k + 1} / ${n} 手`;
  $('navFirst').disabled = $('navPrev').disabled = k <= 0;
  $('navLast').disabled = $('navNext').disabled = k >= n;

  // —— 汇总 ——
  const sum = summarize(review.items);
  const analysing = review.done < review.total;
  const worst = review.items.filter((it) => it && (it.cls === 'mistake' || it.cls === 'blunder'))
    .sort((a, b) => b.loss - a.loss).slice(0, 4).sort((a, b) => a.ply - b.ply);
  const r = game.result;
  $('summaryCard').innerHTML = `
    <div class="sum-head">
      <div class="acc" style="--p:${sum.analyzed ? sum.accuracy.toFixed(0) : 0}"><div><b>${sum.analyzed ? sum.accuracy.toFixed(0) : '–'}</b><span>准确率</span></div></div>
      <div>
        <div class="sum-title">${resultTitle()} · ${esc(r.reason)}</div>
        <div class="sum-sub">你执${SIDE_NAME[game.playerSide]}，共 ${Math.ceil(n / 2)} 回合，用${ENGINE_NAME[review.engine]}评了你的 ${review.total} 步棋</div>
      </div>
    </div>
    <div class="counts">${CLASS_ORDER.map((c) => `
      <div class="count" style="--c:${CLASSES[c].color}"><b>${sum.counts[c]}</b><span>${CLASSES[c].label}</span></div>`).join('')}
    </div>
    ${review.notice ? `<div class="sum-notice">${esc(review.notice)}</div>` : ''}
    ${analysing && pikaLoad ? `<div class="progress">
      <div class="progress-bar"><i data-pika-bar style="width:${(pikaLoad.done / pikaLoad.total * 100).toFixed(1)}%"></i></div>
      <div class="progress-text" data-pika-text>${pikaLoadText()}</div></div>`
    : analysing ? `<div class="progress">
      <div class="progress-bar"><i style="width:${(review.done / review.total * 100).toFixed(1)}%"></i></div>
      <div class="progress-text">${ENGINE_NAME[review.engine]}正在逐步分析… ${review.done} / ${review.total}</div></div>` : ''}
    <div class="chart-wrap">
      <div class="chart-cap"><span>你的胜率走势（上方 = 你占优）</span><span>点击图表跳转</span></div>
      ${chartSvg()}
    </div>
    ${worst.length ? `<div class="keys"><span>关键失误：</span>${worst.map((it) => `
      <button type="button" data-ply="${it.ply}"><span class="tag" style="--c:${CLASSES[it.cls].color}">${CLASSES[it.cls].symbol}</span>${Math.floor(it.ply / 2) + 1}. ${esc(game.texts[it.ply])}</button>`).join('')}</div>`
      : !analysing && sum.analyzed ? '<div class="keys"><span>这一局没有明显的失误，下得很稳。</span></div>' : ''}
    <div class="sum-actions">
      <select id="selDepth" aria-label="分析引擎和强度">${ANALYSIS.map((d) => `<option value="${d.id}" ${d.id === review.option ? 'selected' : ''}>${d.name}</option>`).join('')}</select>
      <button type="button" data-act="back">返回棋局</button>
      <button type="button" class="primary" data-act="new">再来一局</button>
    </div>`;

  // —— 单步讲解 ——
  const detail = $('detailCard');
  if (k >= n) {
    detail.innerHTML = `<div class="detail-head"><span class="played">终局</span><span class="who">${resultTitle()} · ${esc(r.reason)}</span></div>
      <p class="detail-text muted">这是最后的局面。用“上一步”或点击棋谱，回看每一步的讲解。</p>`;
  } else {
    const mine = (k % 2 === 0 ? RED : BLACK) === game.playerSide;
    const round = Math.floor(k / 2) + 1;
    const item = review.items[k];
    if (!mine) {
      detail.innerHTML = `<div class="detail-head"><span class="who">第 ${round} 回合 · AI 走了</span><span class="played">${esc(game.texts[k])}</span></div>
        <p class="detail-text muted">这是 AI 的着法，复盘只评价你自己的棋。按“下一步”看你是怎么应对的。</p>`;
    } else if (!item) {
      detail.innerHTML = `<div class="detail-head"><span class="who">第 ${round} 回合 · 你走了</span><span class="played">${esc(game.texts[k])}</span></div>
        <p class="detail-text muted">这一步还在分析中，稍等片刻…</p>`;
    } else {
      const c = CLASSES[item.cls];
      const same = item.best.move === item.move;
      const dim = (arr) => arr.map((t, i) => (i % 2 ? `<i>${esc(t)}</i>` : esc(t))).join(' ');
      detail.innerHTML = `
        <div class="detail-head">
          <span class="tag" style="--c:${c.color}">${c.symbol} ${c.label}</span>
          <span class="who">第 ${round} 回合 · 你走了</span><span class="played">${esc(game.texts[k])}</span>
        </div>
        <p class="detail-text">${esc(item.text)}</p>
        ${same ? '' : `<div class="rec"><span>推荐走法</span><b>${esc(item.bestText)}</b></div>`}
        <dl class="lines">
          ${same ? '' : `<div><dt>按推荐走，后续可能是</dt><dd>${dim(item.bestLine)}</dd></div>`}
          ${item.playedLine.length > 1 ? `<div><dt>${same ? '后续可能是' : '实战这步之后，对方最强的应对'}</dt><dd>${dim(item.playedLine)}</dd></div>` : ''}
        </dl>
        <div class="evalrow">
          <span>局面评分（你的视角）：${same ? formatScore(item.played.score) : `${formatScore(item.best.score)} → ${formatScore(item.played.score)}`}</span>
          <span>${ENGINE_NAME[review.engine]} · 搜索深度 ${item.best.depth} 层</span>
        </div>
        <div class="legend">
          <span><i style="--c:${c.color}"></i>你的走法</span>
          ${same ? '' : `<span><i style="--c:${BEST_COLOR}"></i>推荐走法</span>`}
        </div>`;
    }
  }

  renderMoves($('reviewMoves'), true);
}

// ---------------------------------------------------------------------------
// 事件
// ---------------------------------------------------------------------------

function onAction(act) {
  if (act === 'review') startReview();
  else if (act === 'new') newGame();
  else if (act === 'back') { leaveReview(); render(); }
}

$('selLevel').innerHTML = LEVELS.map((l) => `<option value="${l.id}">${l.name}</option>`).join('');

$('btnNew').addEventListener('click', () => {
  if (game.moves.length > 1 && !game.result && !window.confirm('当前对局还没结束，确定重新开始吗？')) return;
  newGame();
});
$('btnUndo').addEventListener('click', undo);
$('btnHint').addEventListener('click', requestHint);
$('btnResign').addEventListener('click', resign);
$('selLevel').addEventListener('change', () => {
  game.level = +$('selLevel').value;
  save();
  renderSeats();
});
$('selSide').addEventListener('change', () => {
  const inProgress = game.moves.length > 1 && !game.result;
  if (inProgress && !window.confirm('换边需要重新开始一局，确定吗？')) {
    $('selSide').value = String(game.playerSide);
    return;
  }
  newGame();
});
$('statusCard').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b) onAction(b.dataset.act);
});
$('summaryCard').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b && b.dataset.act) return onAction(b.dataset.act);
  if (b && b.dataset.ply) return setCursor(+b.dataset.ply, true);
  const chart = e.target.closest('#chart');
  if (chart) {
    const rect = chart.getBoundingClientRect();
    setCursor(Math.round(((e.clientX - rect.left) / rect.width) * game.moves.length), true);
  }
});
$('summaryCard').addEventListener('change', (e) => {
  if (e.target.id !== 'selDepth') return;
  review.option = e.target.value;
  store.set(PREFS_KEY, { analysis: review.option });
  runAnalysis();
  renderReview();
  renderBoard();
});
$('reviewMoves').addEventListener('click', (e) => {
  const b = e.target.closest('.mv');
  if (b) setCursor(+b.dataset.ply, true);
});
$('navFirst').addEventListener('click', () => setCursor(0));
$('navPrev').addEventListener('click', () => setCursor(review.cursor - 1));
$('navNext').addEventListener('click', () => setCursor(review.cursor + 1));
$('navLast').addEventListener('click', () => setCursor(game.moves.length));
document.addEventListener('keydown', (e) => {
  if (mode !== 'review' || e.target.closest('select, input, textarea')) return;
  if (e.key === 'ArrowLeft') { setCursor(review.cursor - 1); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { setCursor(review.cursor + 1); e.preventDefault(); }
  else if (e.key === 'Home') { setCursor(0); e.preventDefault(); }
  else if (e.key === 'End') { setCursor(game.moves.length); e.preventDefault(); }
});

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------

if (location.protocol === 'file:') {
  showNotice('你正在直接打开本地文件，浏览器会阻止引擎线程。请在项目目录运行 “python3 -m http.server 8080” 后访问 http://localhost:8080 。');
}
startEngine();
restore();
render();
aiTurn();

// 方便调试和自动化测试
window.__xq = { game, review, get pos() { return pos; }, get mode() { return mode; }, playMove, iccsToMove, moveToIccs };
