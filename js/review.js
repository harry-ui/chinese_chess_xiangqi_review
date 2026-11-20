// 复盘：把引擎的分析结果变成“这步棋好不好、为什么、应该怎么走”。

import { MATE, BAN, WIN, KING, PAWN, pieceSide, sqY, RED } from './engine.js';
import { moveToChinese, lineToChinese, pieceName } from './notation.js';

export const CLASSES = {
  best: { label: '最佳', symbol: '★', color: '#2f9e61' },
  good: { label: '好棋', symbol: '✓', color: '#7aa63c' },
  inaccuracy: { label: '缓着', symbol: '?!', color: '#d39e00' },
  mistake: { label: '失误', symbol: '?', color: '#e8791d' },
  blunder: { label: '漏着', symbol: '??', color: '#d33a2c' },
};
export const CLASS_ORDER = ['best', 'good', 'inaccuracy', 'mistake', 'blunder'];

// 把引擎分数（走子方视角，约 100 分 = 一个过河兵）换算成胜率
export function winProb(score) {
  const cp = score > WIN ? 3000 : score < -WIN ? -3000 : score;
  return 1 / (1 + Math.exp(-cp / 300));
}

// 杀棋还需要几步（己方的步数）；不是杀棋返回 0
export function mateIn(score) {
  const a = Math.abs(score);
  return a > BAN ? Math.ceil((MATE - a) / 2) : 0;
}

export function formatScore(score) {
  const m = mateIn(score);
  if (m) return (score > 0 ? '胜势·' : '败势·') + m + '步杀';
  if (score > WIN) return '胜势';
  if (score < -WIN) return '败势';
  const v = score / 100;
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);
}

// 给一步棋定级。主要看胜率损失；但在大优或大劣的局面里胜率变化很小，
// 所以再用“实际丢了多少分”兜底：白丢一个子，无论局面如何都算失误。
export function classify(bestScore, playedScore, sameMove) {
  if (sameMove) return { cls: 'best', loss: 0 };
  const clamp = (v) => Math.max(-2500, Math.min(2500, v));
  const winLoss = Math.max(0, winProb(bestScore) - winProb(playedScore)) * 100;
  const cpLoss = clamp(bestScore) - clamp(playedScore);
  let floor = cpLoss >= 700 ? 25 : cpLoss >= 350 ? 12 : cpLoss >= 180 ? 5 : 0;
  // 走完仍是必胜，或者本来就已无可挽回：最多算缓着
  if (playedScore >= 1000 || bestScore <= -1500) floor = Math.min(floor, 5);
  const loss = Math.max(winLoss, floor);
  let cls;
  if (loss < 1) cls = 'best';
  else if (loss < 5) cls = 'good';
  else if (loss < 12) cls = 'inaccuracy';
  else if (loss < 25) cls = 'mistake';
  else cls = 'blunder';
  return { cls, loss };
}

export function accuracyOf(loss) {
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));
}

// 讲解用的简化子力价值：兵 1（过河 2）、士象 2、马 4、炮 4.5、车 9
const SIMPLE_VALUE = [100, 2, 2, 4, 9, 4.5, 1];
function simpleValue(pc, sq) {
  if ((pc & 7) !== PAWN) return SIMPLE_VALUE[pc & 7];
  const crossed = pieceSide(pc) === RED ? sqY(sq) <= 4 : sqY(sq) >= 5;
  return crossed ? 2 : 1;
}

// 沿着一条变化走下去，统计 side 一方吃到和丢掉的子
function trace(pos, line, side, limit = 12) {
  const t = { swing: 0, won: [], lost: [] };
  let made = 0;
  for (let i = 0; i < line.length && i < limit; i++) {
    const mv = line[i];
    const mover = pos.sq[mv & 255], victim = pos.sq[mv >> 8];
    if (!mover) break;
    const gain = victim ? simpleValue(victim, mv >> 8) : 0;
    if (!pos.makeMove(mv)) break;
    made++;
    if (!victim) continue;
    if (pieceSide(mover) === side) { t.swing += gain; t.won.push(victim); }
    else { t.swing -= gain; t.lost.push(victim); }
  }
  while (made-- > 0) pos.undoMakeMove();
  return t;
}

function names(pieces) {
  const count = new Map();
  for (const pc of pieces) count.set(pieceName(pc), (count.get(pieceName(pc)) || 0) + 1);
  return [...count].map(([n, c]) => (c > 1 ? `${'零一两三四五'[c]}个${n}` : n)).join('、');
}

// 生成一步棋的讲解。pos 是走这步棋之前的局面（内部会临时走子并恢复）。
// item: { move, cls, best: {move, score, pv}, played: {score, pv} }
export function explain(pos, item) {
  const side = pos.side;
  const { best, played, cls } = item;
  const same = item.move === best.move;
  const bestText = moveToChinese(pos, best.move);
  const capPlayed = pos.sq[item.move >> 8];
  const capBest = pos.sq[best.move >> 8];
  const mPlayed = mateIn(played.score), mBest = mateIn(best.score);

  if (cls === 'best' || cls === 'good') {
    if (mPlayed && played.score > 0) {
      return mPlayed === 1 ? '绝杀，对方已无法解将。' : `走出了杀着，最多再有 ${mPlayed - 1} 步就能将死对方。`;
    }
    if (mBest && best.score > 0 && !same) {
      return mPlayed && played.score > 0
        ? `这步也能杀，不过 ${bestText} 更快（${mBest} 步杀）。`
        : `局面仍是胜势，不过这里有更快的杀法：${bestText}，${mBest} 步可以将死对方。`;
    }
    if (mBest && best.score < 0) return '局面已经无法挽回，无论怎么走都难逃被将死。';
    if (winProb(best.score) < 0.05) {
      return same ? '局面已经非常困难，这是相对最顽强的走法。' : `局面已经非常困难，这步和引擎首选的 ${bestText} 差别不大。`;
    }
    if (same) {
      return capPlayed
        ? `正确。吃掉对方的${pieceName(capPlayed)}，这是此时最好的一手。`
        : '这是此时最好的一手，和引擎的首选一致。';
    }
    return cls === 'best'
      ? `很好的一手，与引擎首选的 ${bestText} 几乎没有差别。`
      : `不错的一手。引擎略微更喜欢 ${bestText}，但差距很小。`;
  }

  const parts = [];
  const tp = trace(pos, played.pv, side);
  const tb = trace(pos, best.pv, side);
  let mentionedBest = false;

  // —— 这步棋的问题出在哪 ——
  let replyText = '', victim = 0, lostNow = 0;
  if (played.pv.length > 1 && pos.makeMove(item.move)) {
    const reply = played.pv[1];
    victim = pos.sq[reply >> 8];
    replyText = moveToChinese(pos, reply);
    lostNow = victim ? simpleValue(victim, reply >> 8) : 0;
    pos.undoMakeMove();
  }
  if (mPlayed && played.score < 0) {
    if (victim) parts.push(`走完这步，对方可以 ${replyText} 吃掉你的${pieceName(victim)}，随后形成连杀，最快 ${mPlayed} 步就会被将死。`);
    else parts.push(`这步棋之后对方有连杀${replyText ? `（${replyText} 起）` : ''}，最快 ${mPlayed} 步就会被将死。`);
  } else if (replyText && tp.swing <= -1.5) {
    const back = tp.won.length ? `，只换回${names(tp.won)}` : '';
    if (victim && capPlayed && tp.lost.length === 1) {
      parts.push(`虽然吃到了${pieceName(capPlayed)}，但对方 ${replyText} 吃回你的${pieceName(victim)}，得不偿失。`);
    } else if (victim && lostNow >= -tp.swing * 0.6) {
      parts.push(`走完这步，对方可以 ${replyText} 吃掉你的${pieceName(victim)}。`);
    } else {
      parts.push(`走完这步，对方有 ${replyText} 的手段，照这个变化下去你会丢掉${names(tp.lost)}${back}。`);
    }
  }

  // —— 错过了什么 ——
  if (mBest && best.score > 0 && !(mPlayed && played.score > 0)) {
    parts.push(`这里其实有杀棋：${bestText} 起，${mBest} 步可以将死对方。`);
    mentionedBest = true;
  } else if (capBest && (capBest & 7) !== KING && tb.swing >= 1 &&
    (!capPlayed || simpleValue(capBest, best.move >> 8) > simpleValue(capPlayed, item.move >> 8))) {
    parts.push(`错过了 ${bestText} 吃${pieceName(capBest)}的机会。`);
    mentionedBest = true;
  } else if (tb.swing >= 1.5 && tb.swing - tp.swing >= 1.5) {
    parts.push(`更好的是 ${bestText}，照引擎算出的变化可以得子（${names(tb.won)}）。`);
    mentionedBest = true;
  }

  if (parts.length === 0) {
    if (cls === 'inaccuracy') parts.push(`这步稍缓：没有直接丢子，但 ${bestText} 能让你的局面更好一些。`);
    else if (cls === 'mistake') parts.push(`这步棋让局面明显变差。引擎认为 ${bestText} 要好得多，可以对照下面两条变化看看差别。`);
    else parts.push(`这是一步严重的失误，局面急转直下。应该走 ${bestText}，可以对照下面两条变化看看差别。`);
  } else if (!mentionedBest) {
    parts.push(`应该走 ${bestText}。`);
  }
  return parts.join('');
}

// 汇总整局
export function summarize(items) {
  const counts = { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
  let acc = 0, n = 0;
  for (const it of items) {
    if (!it) continue;
    counts[it.cls]++;
    acc += accuracyOf(it.loss);
    n++;
  }
  return { counts, accuracy: n ? acc / n : 0, analyzed: n };
}
