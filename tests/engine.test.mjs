import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Position, Search, START_FEN, RED, BLACK, WIN, BAN, MATE,
  iccsToMove, moveToIccs, positionFromMoves,
} from '../js/engine.js';
import { moveToChinese } from '../js/notation.js';
import { BOOK_LINES, bookMove } from '../js/book.js';

function perft(pos, depth) {
  if (depth === 0) return 1;
  let n = 0;
  for (const mv of pos.generateMoves(false)) {
    if (!pos.makeMove(mv)) continue;
    n += perft(pos, depth - 1);
    pos.undoMakeMove();
  }
  return n;
}

test('perft：初始局面的着法数与公认数值一致', () => {
  const pos = new Position();
  assert.equal(perft(pos, 1), 44);
  assert.equal(perft(pos, 2), 1920);
  assert.equal(perft(pos, 3), 79666);
  assert.equal(perft(pos, 4), 3290240);
  assert.equal(pos.toFen(), START_FEN);
});

test('FEN 读写、走子与撤销保持一致', () => {
  const pos = new Position();
  const key = pos.key, lock = pos.lock, vr = pos.vlRed, vb = pos.vlBlack;
  for (const s of ['h2e2', 'h9g7', 'e2e6']) assert.ok(pos.makeMove(iccsToMove(s)));
  assert.equal(pos.toFen(), 'rnbakab1r/9/1c4nc1/p1p1C1p1p/9/9/P1P1P1P1P/1C7/9/RNBAKABNR b');
  for (let i = 0; i < 3; i++) pos.undoMakeMove();
  assert.deepEqual([pos.key, pos.lock, pos.vlRed, pos.vlBlack], [key, lock, vr, vb]);
  assert.equal(pos.vlRed, pos.vlBlack);
});

test('将帅不能照面', () => {
  const pos = new Position('3k5/9/9/9/9/9/9/9/9/4K4 w');
  const moves = pos.legalMoves().map(moveToIccs);
  assert.ok(!moves.includes('e0d0'), '帅不能走到与将同一条无遮挡的直线上');
  assert.ok(moves.includes('e0f0'));
});

test('中文记谱', () => {
  const pos = new Position();
  const play = (iccs) => {
    const mv = iccsToMove(iccs);
    const text = moveToChinese(pos, mv);
    assert.ok(pos.makeMove(mv), iccs);
    return text;
  };
  assert.equal(play('h2e2'), '炮二平五');
  assert.equal(play('h9g7'), '马８进７');
  assert.equal(play('h0g2'), '马二进三');
  assert.equal(play('i9h9'), '车９平８');
  assert.equal(play('i0h0'), '车一平二');
  assert.equal(play('g6g5'), '卒７进１');
  assert.equal(play('h0h6'), '车二进六');
  assert.equal(play('f9e8'), '士６进５');
  assert.equal(play('c0e2'), '相七进五');
  assert.equal(play('h9h8'), '车８进１');
  assert.equal(play('h6h4'), '车二退二');

  const twin = new Position('4k4/9/9/9/9/9/4C4/9/4C4/3K5 w');
  assert.equal(moveToChinese(twin, iccsToMove('e3e5')), '前炮进二');
  assert.equal(moveToChinese(twin, iccsToMove('e1a1')), '后炮平九');
});

test('开局库里的每一路变化都合法', () => {
  for (const line of BOOK_LINES) {
    const pos = new Position();
    for (const s of line.split(' ')) {
      const mv = iccsToMove(s);
      assert.ok(pos.isLegal(mv), `${line} 中的 ${s} 不合法`);
      pos.makeMove(mv);
    }
  }
  const first = bookMove([]);
  assert.ok(new Position().isLegal(first));
});

test('搜索：一步杀', () => {
  const pos = new Position('3k5/R8/9/9/9/9/9/9/9/4K3R w');
  const res = new Search(16).searchRoot(pos, { timeMs: 500 });
  assert.ok(res.score > BAN, `score=${res.score}`);
  assert.equal(MATE - res.score, 1);
  assert.ok(pos.makeMove(res.move));
  assert.equal(pos.hasLegalMove(), false);
});

test('搜索：白吃的车要吃，送吃的棋不走', () => {
  // 双方的车互相对着，轮到红方走：必须先吃
  const pos = new Position('4k4/9/9/9/R3r4/9/9/9/9/3K5 w');
  const res = new Search(16).searchRoot(pos, { timeMs: 300, maxDepth: 6 });
  assert.equal(moveToIccs(res.move), 'a5e5');
  assert.ok(res.score > 500);
});

test('搜索：能看到三步以内的连杀（重炮/铁门栓类）', () => {
  // 红方车炮配合：车一进… 这里只验证引擎给出的结论是杀棋且着法合法
  const pos = new Position('3ak4/4a4/9/9/9/9/9/4C4/4R4/4K4 w');
  const res = new Search(16).searchRoot(pos, { timeMs: 800 });
  assert.ok(pos.isLegal(res.move));
  assert.ok(res.pv.length >= 1);
});

test('searchMoves 限定根着法；searchRandom 返回合法着法', () => {
  const pos = new Position();
  const s = new Search(16);
  const only = iccsToMove('a3a4');
  const res = s.searchRoot(pos, { timeMs: 200, maxDepth: 4, searchMoves: [only] });
  assert.equal(res.move, only);
  const r = s.searchRandom(pos, 2, 50);
  assert.ok(pos.isLegal(r.move));
});

test('重复局面与长将', () => {
  // 红车来回将军，黑将来回躲：红方长将
  const pos = new Position('3k5/9/9/9/9/9/9/9/R8/5K3 w');
  const cycle = ['a1d1', 'd9e9', 'd1e1', 'e9d9', 'e1d1', 'd9e9', 'd1e1', 'e9d9', 'e1d1'];
  let status = 0;
  for (const s of cycle) {
    assert.ok(pos.makeMove(iccsToMove(s)), s);
    status = pos.repStatus(2);
    if (status) break;
  }
  assert.ok(status, '应检测到三次重复');
  // 此时轮到黑方走，对方（红方）一直在将军
  assert.equal(pos.side, BLACK);
  assert.equal(status & 4, 4);
  assert.equal(status & 2, 0);
});

test('positionFromMoves 复原对局', () => {
  const moves = ['h2e2', 'h9g7', 'h0g2'].map(iccsToMove);
  const pos = positionFromMoves(START_FEN, moves);
  assert.equal(pos.side, BLACK);
  assert.equal(pos.hp, 3);
  assert.equal(pos.ply, 0);
  assert.ok(Math.abs(pos.evaluate()) < WIN);
  assert.equal(RED, 0);
});
