// 小型开局库：只覆盖最常见的几路布局，让 AI 的开局有些变化。之后交给引擎。

import { iccsToMove, moveToIccs } from './engine.js';

export const BOOK_LINES = [
  // 中炮对屏风马
  'h2e2 h9g7 h0g2 i9h9 i0h0 b9c7 c3c4 g6g5',
  'h2e2 h9g7 h0g2 b9c7 i0h0 i9h9 c3c4 g6g5',
  'h2e2 b9c7 h0g2 h9g7 i0h0 i9h9 g3g4 c6c5',
  // 顺炮
  'h2e2 h7e7 h0g2 h9g7 i0h0 i9h9 b0c2 b9c7',
  // 列炮
  'h2e2 b7e7 h0g2 b9c7 i0h0 a9b9',
  // 中炮对反宫马
  'h2e2 b9c7 h0g2 h7f7 i0h0 h9g7',
  // 炮八平五（左中炮）
  'b2e2 b9c7 b0c2 a9b9 a0b0 h9g7',
  'b2e2 b7e7 b0c2 b9c7 a0b0 a9b9',
  // 飞相局
  'g0e2 h7d7 h0g2 h9g7 i0h0 i9h9',
  'g0e2 b7e7 h0g2 b9c7 i0h0 h9g7',
  'g0e2 g6g5 h0g2 h9g7',
  // 仙人指路
  'c3c4 g6g5 h0g2 h9g7',
  'c3c4 b7c7 h2e2 g9e7',
  'c3c4 g9e7 h0g2 g6g5',
  // 起马局
  'h0g2 g6g5 c3c4 h9g7',
  'h0g2 c6c5 g3g4 b9c7',
  // 过宫炮、士角炮
  'h2d2 h9g7 h0g2 i9h9 i0h0',
  'h2f2 h9g7 h0g2 i9h9 i0h0',
];

const TABLE = new Map();
for (const line of BOOK_LINES) {
  const moves = line.split(' ');
  for (let i = 0; i < moves.length; i++) {
    const key = moves.slice(0, i).join(' ');
    if (!TABLE.has(key)) TABLE.set(key, []);
    TABLE.get(key).push(moves[i]);
  }
}

// moves：从初始局面开始已走的着法（整数编码）。返回开局库着法，没有则返回 0。
export function bookMove(moves) {
  if (moves.length >= 8) return 0;
  const options = TABLE.get(moves.map(moveToIccs).join(' '));
  if (!options) return 0;
  return iccsToMove(options[Math.floor(Math.random() * options.length)]);
}
