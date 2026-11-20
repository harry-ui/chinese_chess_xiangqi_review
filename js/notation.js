// 中文纵线记谱法：炮二平五、马８进７、前车进一 等。

import { RED, KING, ADVISOR, BISHOP, PAWN, ROOK, CANNON, sqOf, sqX, sqY } from './engine.js';

export const PIECE_NAMES = [
  ['帅', '仕', '相', '马', '车', '炮', '兵'],
  ['将', '士', '象', '马', '车', '炮', '卒'],
];

const RED_DIGITS = '一二三四五六七八九';
const BLACK_DIGITS = '１２３４５６７８９';
const ORDER_LABELS = { 2: ['前', '后'], 3: ['前', '中', '后'], 4: ['前', '二', '三', '后'], 5: ['前', '二', '三', '四', '后'] };

export function pieceName(pc) {
  return PIECE_NAMES[pc < 16 ? 0 : 1][pc & 7];
}

// pos 为走这步棋之前的局面
export function moveToChinese(pos, mv) {
  const src = mv & 255, dst = mv >> 8;
  const pc = pos.sq[src];
  const side = pc < 16 ? RED : 1;
  const type = pc & 7;
  const x1 = sqX(src), y1 = sqY(src), x2 = sqX(dst), y2 = sqY(dst);
  const digits = side === RED ? RED_DIGITS : BLACK_DIGITS;
  const fileNo = (x) => (side === RED ? 9 - x : x + 1); // 各自从自己的右手边数起
  const digit = (n) => digits[n - 1];
  const name = pieceName(pc);

  let action, target;
  if (y1 === y2) {
    action = '平';
    target = digit(fileNo(x2));
  } else {
    const forward = side === RED ? y1 > y2 : y2 > y1;
    action = forward ? '进' : '退';
    const straight = type === KING || type === ROOK || type === CANNON || type === PAWN;
    target = straight ? digit(Math.abs(y2 - y1)) : digit(fileNo(x2));
  }

  let prefix = name + digit(fileNo(x1));
  if (type !== KING && type !== ADVISOR && type !== BISHOP) {
    // 同一条纵线上有多个相同棋子时用 前/后 区分；“前”指更靠近对方底线
    const ys = [];
    for (let y = 0; y < 10; y++) if (pos.sq[sqOf(x1, y)] === pc) ys.push(y);
    if (ys.length > 1) {
      if (side !== RED) ys.reverse();
      const label = ORDER_LABELS[ys.length][ys.indexOf(y1)];
      if (type === PAWN) {
        let crowded = 0;
        for (let x = 0; x < 9; x++) {
          let n = 0;
          for (let y = 0; y < 10; y++) if (pos.sq[sqOf(x, y)] === pc) n++;
          if (n > 1) crowded++;
        }
        prefix = crowded > 1 ? label + digit(fileNo(x1)) : label + name;
      } else {
        prefix = label + name;
      }
    }
  }
  return prefix + action + target;
}

// 把一串着法转成记谱文字（会临时在 pos 上走子，结束后恢复）
export function lineToChinese(pos, moves, limit = moves.length) {
  const out = [];
  let made = 0;
  for (let i = 0; i < moves.length && i < limit; i++) {
    const text = moveToChinese(pos, moves[i]);
    if (!pos.sq[moves[i] & 255] || !pos.makeMove(moves[i])) break;
    out.push(text);
    made++;
  }
  while (made-- > 0) pos.undoMakeMove();
  return out;
}
