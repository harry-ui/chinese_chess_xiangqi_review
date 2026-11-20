import test from 'node:test';
import assert from 'node:assert/strict';
import { MATE, START_FEN, iccsToMove } from '../js/engine.js';
import { parseInfo, toScore, scoreAfterMove, positionCommand } from '../js/pikafish.js';
import { mateIn } from '../js/review.js';

test('解析 UCI 的 info 行', () => {
  const a = parseInfo('info depth 13 seldepth 17 multipv 1 score cp 29 wdl 76 913 11 nodes 41956 nps 129493 hashfull 14 tbhits 0 time 324 pv b2e2 f9e8 b0c2');
  assert.deepEqual(a, { depth: 13, cp: 29, mate: null, bound: false, pv: ['b2e2', 'f9e8', 'b0c2'] });
  const b = parseInfo('info depth 14 seldepth 17 multipv 1 score cp 23 lowerbound nodes 76846 pv h2e2 b7e7');
  assert.equal(b.bound, true);
  const c = parseInfo('info depth 245 seldepth 2 multipv 1 score mate -3 nodes 7598 pv i0f0');
  assert.equal(c.mate, -3);
  assert.equal(parseInfo('info string NNUE evaluation using pikafish.nnue'), null);
  assert.equal(parseInfo('bestmove h2e2 ponder b7e7'), null);
});

test('分数换算', () => {
  assert.equal(toScore({ cp: 100, mate: null }), 190);
  assert.equal(toScore({ cp: -521, mate: null }), -990);
  // 杀棋：N 步杀 = 2N-1 个半回合；被 N 步杀 = 2N 个半回合
  assert.equal(toScore({ cp: null, mate: 1 }), MATE - 1);
  assert.equal(toScore({ cp: null, mate: 3 }), MATE - 5);
  assert.equal(toScore({ cp: null, mate: -2 }), -(MATE - 4));
  assert.equal(mateIn(toScore({ cp: null, mate: 3 })), 3);
  assert.equal(mateIn(toScore({ cp: null, mate: -2 })), 2);
});

test('走子后的分数换回走子方视角', () => {
  assert.equal(scoreAfterMove(150), -150);
  // 对方 2 步杀 -> 我方被 2 步杀
  const lost = scoreAfterMove(toScore({ cp: null, mate: 2 }));
  assert.ok(lost < 0);
  assert.equal(mateIn(lost), 2);
  // 对方被 2 步杀 -> 算上刚走的这一步，我方 3 步杀
  const won = scoreAfterMove(toScore({ cp: null, mate: -2 }));
  assert.ok(won > 0);
  assert.equal(mateIn(won), 3);
});

test('position 命令', () => {
  assert.equal(positionCommand(START_FEN, []), 'position startpos');
  assert.equal(positionCommand(START_FEN, ['h2e2', 'h9g7'].map(iccsToMove)), 'position startpos moves h2e2 h9g7');
  assert.equal(positionCommand('3k5/9/9/9/9/9/9/9/9/4K4 w', []), 'position fen 3k5/9/9/9/9/9/9/9/9/4K4 w - - 0 1');
});
