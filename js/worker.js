// 引擎线程：负责 AI 走棋和复盘分析，避免卡住界面。

import { Search, positionFromMoves } from './engine.js';

const search = new Search(20);

// 分析一步棋：先找出局面的最佳着法，再用同样的深度评估实战着法
export function analyzeMove(search, pos, played, timeMs) {
  pos.contempt = 0;
  const main = search.searchRoot(pos, { timeMs, minDepth: 3 });
  const best = { move: main.move, score: main.score, pv: main.pv, depth: main.depth };
  if (main.move === played) return { best, played: { score: main.score, pv: main.pv, depth: main.depth } };
  const alt = search.searchRoot(pos, {
    timeMs: timeMs * 1.5, minDepth: Math.min(3, main.depth), maxDepth: Math.max(1, main.depth), searchMoves: [played],
  });
  // 两次搜索的深度可能略有出入：实战着法不比“最佳”差时，视为同样好
  if (alt.score >= main.score) {
    return { best: { move: played, score: alt.score, pv: alt.pv, depth: alt.depth }, played: { score: alt.score, pv: alt.pv, depth: alt.depth } };
  }
  return { best, played: { score: alt.score, pv: alt.pv, depth: alt.depth } };
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof window === 'undefined') {
  self.onmessage = (e) => {
    const msg = e.data;
    const pos = positionFromMoves(msg.fen, msg.moves);
    if (msg.type === 'play') {
      pos.contempt = 20;
      const res = msg.random
        ? search.searchRandom(pos, msg.random.depth, msg.random.margin)
        : search.searchRoot(pos, { timeMs: msg.timeMs, maxDepth: msg.maxDepth, single: true });
      self.postMessage({ type: 'play', id: msg.id, move: res.move, score: res.score, depth: res.depth, pv: res.pv });
    } else if (msg.type === 'analyze') {
      const res = analyzeMove(search, pos, msg.played, msg.timeMs);
      self.postMessage({ type: 'analyze', id: msg.id, ply: msg.ply, ...res });
    }
  };
  self.postMessage({ type: 'ready' });
}
