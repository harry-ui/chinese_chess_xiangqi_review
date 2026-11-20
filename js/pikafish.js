// 皮卡鱼（Pikafish）引擎的主线程封装：下载引擎文件、管理若干引擎线程、
// 把 UCI 输出换算成和内置引擎一致的结果格式。

import { MATE, BAN, START_FEN, iccsToMove, moveToIccs } from './engine.js';

const BASE = new URL('../vendor/pikafish/', import.meta.url);
const FILES = { wasm: ['pikafish.wasm', 789696], data: ['pikafish.data', 12646031] };
export const PIKAFISH_BYTES = FILES.wasm[1] + FILES.data[1];

// 皮卡鱼的分值大约是内置引擎的一半（多一个车约 +520，内置引擎约 +950）。
// 乘上这个系数后，定级和显示可以沿用同一套阈值。
const SCORE_SCALE = 1.9;
const SCORE_CAP = 9000;

// 解析一行 "info depth 14 ... score cp 23 ... pv h2e2 b7e7"；不是完整结果则返回 null
export function parseInfo(line) {
  if (!line.startsWith('info ') || !line.includes(' score ')) return null;
  const tok = line.split(/\s+/);
  const info = { depth: 0, cp: null, mate: null, bound: false, pv: [] };
  for (let i = 1; i < tok.length; i++) {
    const t = tok[i];
    if (t === 'depth') info.depth = +tok[++i];
    else if (t === 'score') {
      const kind = tok[++i], val = +tok[++i];
      if (kind === 'cp') info.cp = val; else if (kind === 'mate') info.mate = val;
    } else if (t === 'lowerbound' || t === 'upperbound') info.bound = true;
    else if (t === 'pv') { info.pv = tok.slice(i + 1); break; }
  }
  return info.cp === null && info.mate === null ? null : info;
}

// 换算成内置引擎的分数：普通分值按比例放大；杀棋记为 ±(MATE - 距离杀棋的半回合数)
export function toScore(info) {
  if (info.mate !== null) {
    if (info.mate > 0) return MATE - (2 * info.mate - 1);
    return -(MATE - 2 * -info.mate);
  }
  return Math.max(-SCORE_CAP, Math.min(SCORE_CAP, Math.round(info.cp * SCORE_SCALE)));
}

// 走了一步之后，从对方视角得到的分数换回走子方视角（杀棋距离多算这一步）
export function scoreAfterMove(opponentScore) {
  if (opponentScore > BAN) return -(opponentScore - 1);
  if (opponentScore < -BAN) return -(opponentScore + 1);
  return -opponentScore;
}

export function positionCommand(fen, moves) {
  const head = !fen || fen === START_FEN ? 'position startpos' : `position fen ${fen} - - 0 1`;
  return moves.length ? `${head} moves ${moves.map(moveToIccs).join(' ')}` : head;
}

let assetsPromise = null;

// 下载引擎文件（只下载一次）。onProgress(已下载字节, 总字节)
export function loadAssets(onProgress) {
  if (!assetsPromise) {
    let done = 0;
    const get = async ([name, size]) => {
      const res = await fetch(new URL(name, BASE));
      if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
      const out = new Uint8Array(size);
      const reader = res.body.getReader();
      let at = 0;
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        if (at + value.length > size) throw new Error(`${name}: 文件大小不符`);
        out.set(value, at);
        at += value.length;
        done += value.length;
        if (onProgress) onProgress(done, PIKAFISH_BYTES);
      }
      if (at !== size) throw new Error(`${name}: 文件不完整（${at} / ${size}）`);
      return out.buffer;
    };
    assetsPromise = Promise.all([get(FILES.wasm), get(FILES.data)])
      .then(([wasm, data]) => ({ wasm, data }))
      .catch((err) => { assetsPromise = null; throw err; });
  }
  return assetsPromise;
}

// 一个引擎线程。同一时间只跑一条搜索。
class Engine {
  constructor() {
    this.worker = null;
    this.busy = false;
    this.lines = [];
    this.wait = null; // { test, resolve, reject }
  }

  start(assets) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('皮卡鱼引擎启动超时')), 30000);
      const fail = (text) => {
        clearTimeout(timer);
        const err = new Error(text);
        if (this.wait) { const w = this.wait; this.wait = null; w.reject(err); }
        reject(err);
      };
      this.worker = new Worker(new URL('./pikafish-worker.js', import.meta.url));
      this.worker.onerror = (e) => fail(e.message || '引擎线程出错');
      this.worker.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'ready') {
          clearTimeout(timer);
          this.command('uci', (l) => l === 'uciok')
            .then(() => this.command('isready', (l) => l === 'readyok'))
            .then(() => resolve(this), reject);
        } else if (msg.type === 'error') {
          fail(msg.text);
        } else if (msg.type === 'line') {
          this.lines.push(msg.text);
          if (this.wait && this.wait.test(msg.text)) {
            const w = this.wait;
            this.wait = null;
            w.resolve(this.lines.splice(0));
          }
        }
      };
      const wasm = assets.wasm.slice(0), data = assets.data.slice(0);
      this.worker.postMessage({ type: 'init', script: new URL('pikafish.js', BASE).href, wasm, data }, [wasm, data]);
    });
  }

  send(text) {
    this.worker.postMessage({ type: 'cmd', text });
  }

  // 发一条命令，等到某一行输出出现，返回这期间的全部输出
  command(text, until) {
    return new Promise((resolve, reject) => {
      this.lines.length = 0;
      this.wait = { test: until, resolve, reject };
      this.send(text);
    });
  }

  // 搜索一个局面。返回 { move, score, pv, depth }；无子可动时 move 为 0
  async search(fen, moves, timeMs) {
    this.send(positionCommand(fen, moves));
    const lines = await this.command(`go movetime ${Math.max(20, Math.round(timeMs))}`, (l) => l.startsWith('bestmove'));
    const best = lines[lines.length - 1].split(/\s+/)[1];
    if (!best || best === '(none)') return { move: 0, score: -MATE, pv: [], depth: 0 };
    let info = null, any = null;
    for (const line of lines) {
      const parsed = parseInfo(line);
      if (!parsed) continue;
      any = parsed;
      if (!parsed.bound) info = parsed; // 时间用完时最后一行可能只是上下界，取最后一个确切结果
    }
    info = info || any;
    const move = iccsToMove(best);
    let pv = info ? info.pv.map(iccsToMove) : [];
    if (pv[0] !== move) pv = [move];
    return { move, score: info ? toScore(info) : 0, pv, depth: info ? info.depth : 0 };
  }

  stop() {
    if (this.wait) this.send('stop');
  }

  destroy() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
  }
}

// 引擎线程池：复盘时并行分析多步棋，对弈时用其中一个线程走棋
export class PikafishPool {
  constructor() {
    this.engines = [];
    this.queue = [];
    this.gen = 0;
    this.growing = null;
  }

  get ready() {
    return this.engines.length > 0;
  }

  // 保证至少有 n 个引擎线程可用
  async ensure(n, onProgress) {
    while (this.growing) await this.growing.catch(() => {});
    if (this.engines.length >= n) return;
    this.growing = (async () => {
      const assets = await loadAssets(onProgress);
      const fresh = [];
      try {
        while (this.engines.length + fresh.length < n) fresh.push(await new Engine().start(assets));
      } catch (err) {
        if (!this.engines.length && !fresh.length) throw err;
        // 多开线程失败（多半是内存不够）：有几个用几个
      }
      this.engines.push(...fresh);
    })();
    try {
      await this.growing;
    } finally {
      this.growing = null;
    }
    this.pump();
  }

  // 排队执行 job(engine, alive)。alive() 返回 false 表示任务已被取消
  run(job, urgent = false) {
    return new Promise((resolve, reject) => {
      const item = { job, resolve, reject, gen: this.gen };
      if (urgent) this.queue.unshift(item); else this.queue.push(item);
      this.pump();
    });
  }

  pump() {
    for (const eng of this.engines) {
      if (eng.busy || !this.queue.length) continue;
      const item = this.queue.shift();
      eng.busy = true;
      const alive = () => item.gen === this.gen;
      item.job(eng, alive).then(
        (res) => { eng.busy = false; item.resolve(alive() ? res : null); this.pump(); },
        (err) => { eng.busy = false; item.reject(err); this.pump(); },
      );
    }
  }

  // 取消所有排队和进行中的任务（它们的 Promise 会得到 null）
  cancel() {
    this.gen++;
    for (const item of this.queue.splice(0)) item.resolve(null);
    for (const eng of this.engines) if (eng.busy) eng.stop();
  }

  newGame() {
    for (const eng of this.engines) if (!eng.busy) eng.send('ucinewgame');
  }

  // 走一步棋
  play(fen, moves, timeMs) {
    return this.run((eng) => eng.search(fen, moves, timeMs), true);
  }

  // 分析一步棋：先求局面的最佳着法，再评估实战着法走完之后的局面
  analyze({ fen, moves, played, timeMs }) {
    return this.run(async (eng, alive) => {
      const main = await eng.search(fen, moves, timeMs);
      if (!alive() || !main.move) return null;
      const best = { move: main.move, score: main.score, pv: main.pv, depth: main.depth };
      if (main.move === played) return { best, played: { score: main.score, pv: main.pv, depth: main.depth } };
      const after = await eng.search(fen, [...moves, played], timeMs * 0.7);
      if (!alive()) return null;
      const mine = {
        // 走完之后对方无子可动：这一步就是绝杀
        score: after.move ? scoreAfterMove(after.score) : MATE - 1,
        pv: [played, ...after.pv],
        depth: after.depth + 1,
      };
      // 两次搜索各自独立，实战着法不比“最佳”差时视为同样好
      if (mine.score >= best.score) return { best: { move: played, ...mine }, played: mine };
      return { best, played: mine };
    });
  }

  destroy() {
    this.cancel();
    for (const eng of this.engines) eng.destroy();
    this.engines = [];
  }
}
