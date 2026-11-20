import test from 'node:test';
import assert from 'node:assert/strict';
import { Position, Search, MATE, iccsToMove, positionFromMoves, START_FEN } from '../js/engine.js';
import { classify, explain, winProb, mateIn, formatScore, summarize, accuracyOf } from '../js/review.js';
import { analyzeMove } from '../js/worker.js';
import { moveToChinese } from '../js/notation.js';

test('胜率换算与定级', () => {
  assert.equal(winProb(0), 0.5);
  assert.ok(winProb(MATE - 3) > 0.99 && winProb(-MATE + 4) < 0.01);
  assert.equal(classify(50, 50, true).cls, 'best');
  assert.equal(classify(30, 20, false).cls, 'best');
  assert.equal(classify(0, -40, false).cls, 'good');
  assert.equal(classify(0, -100, false).cls, 'inaccuracy');
  assert.equal(classify(0, -250, false).cls, 'mistake');
  assert.equal(classify(0, -450, false).cls, 'blunder');
  // 已经大劣时再白丢一个车，仍然算漏着
  assert.equal(classify(-900, -1800, false).cls, 'blunder');
  // 错过杀棋但仍是必胜局面，不算大错
  assert.equal(classify(MATE - 5, 1600, false).cls, 'inaccuracy');
  // 本来就要被杀，怎么走都一样
  assert.ok(['best', 'good', 'inaccuracy'].includes(classify(-2200, -MATE + 6, false).cls));
  assert.equal(mateIn(MATE - 5), 3);
  assert.equal(mateIn(-MATE + 4), 2);
  assert.equal(formatScore(123), '+1.2');
  assert.equal(formatScore(-80), '−0.8');
  assert.ok(accuracyOf(0) > 99 && accuracyOf(40) < 20);
});

function review(fen, history, playedIccs, timeMs = 400) {
  const moves = history.map(iccsToMove);
  const played = iccsToMove(playedIccs);
  const res = analyzeMove(new Search(18), positionFromMoves(fen, moves), played, timeMs);
  const pos = positionFromMoves(fen, moves);
  const { cls, loss } = classify(res.best.score, res.played.score, res.best.move === played);
  const item = { move: played, cls, loss, best: res.best, played: res.played };
  const fenBefore = pos.toFen();
  const text = explain(pos, item);
  assert.equal(pos.toFen(), fenBefore, '讲解不应改动局面');
  return { ...item, text, bestText: moveToChinese(pos, res.best.move) };
}

test('送车：判为漏着，并指出对方怎么吃', () => {
  // 红车走到黑炮口（炮架是黑卒）
  const r = review('4k4/9/4c4/9/4p4/9/9/9/9/R4K3 w', [], 'a0e0');
  assert.equal(r.cls, 'blunder');
  assert.match(r.text, /吃掉你的车/);
});

test('错过白吃的车：指出该吃', () => {
  const r = review('4k4/9/9/9/R3r4/9/9/9/9/3K5 w', [], 'd0d1');
  assert.equal(r.cls, 'blunder');
  assert.equal(r.bestText, '车九平五');
  assert.match(r.text, /车九平五/);
});

test('走出绝杀：最佳', () => {
  const r = review('3k5/R8/9/9/9/9/9/9/9/4K3R w', [], 'i0i9');
  assert.equal(r.cls, 'best');
  assert.match(r.text, /绝杀/);
});

test('错过一步杀', () => {
  const r = review('3k5/R8/9/9/9/9/9/9/9/4K3R w', [], 'e0e1');
  assert.match(r.text, /车一进九/);
  assert.match(r.text, /杀/);
});

test('开局正着不会被判成坏棋', () => {
  const r = review(START_FEN, ['h2e2', 'h9g7'], 'h0g2', 300);
  assert.ok(['best', 'good'].includes(r.cls), r.cls + ' ' + r.text);
  const s = summarize([r, null]);
  assert.equal(s.analyzed, 1);
  assert.ok(s.accuracy > 80);
  assert.ok(new Position().isLegal(iccsToMove('h2e2')));
});
