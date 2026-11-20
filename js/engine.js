// 中国象棋引擎：局面表示、着法生成、搜索。
// 纯 ES 模块，浏览器主线程、Web Worker 和 Node 测试共用。

export const RED = 0, BLACK = 1;
export const KING = 0, ADVISOR = 1, BISHOP = 2, KNIGHT = 3, ROOK = 4, CANNON = 5, PAWN = 6;

export const MATE = 30000;
export const BAN = MATE - 100;   // 长将判负的分值区间上界
export const WIN = MATE - 200;   // 超过此值说明已算出胜负

export const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';

// ---------------------------------------------------------------------------
// 棋盘：16x16 的一维数组，真实棋盘位于第 3..12 行、第 3..11 列。
// x: 0..8 从红方左手到右手；y: 0..9 从黑方底线到红方底线。
// 棋子编码：红 8+类型，黑 16+类型。着法编码：起点 | 终点 << 8。
// ---------------------------------------------------------------------------

export const sqOf = (x, y) => ((y + 3) << 4) + x + 3;
export const sqX = (sq) => (sq & 15) - 3;
export const sqY = (sq) => (sq >> 4) - 3;
export const mvSrc = (mv) => mv & 255;
export const mvDst = (mv) => mv >> 8;
export const makeMv = (src, dst) => src | (dst << 8);
export const pieceSide = (pc) => (pc < 16 ? RED : BLACK);
export const pieceType = (pc) => pc & 7;

const IN_BOARD = new Uint8Array(256);
const IN_FORT = new Uint8Array(256);
for (let y = 0; y < 10; y++) {
  for (let x = 0; x < 9; x++) {
    const sq = sqOf(x, y);
    IN_BOARD[sq] = 1;
    if (x >= 3 && x <= 5 && (y <= 2 || y >= 7)) IN_FORT[sq] = 1;
  }
}

const KING_DELTA = [-16, -1, 1, 16];
const ADVISOR_DELTA = [-17, -15, 15, 17];
// 马：KNIGHT_DELTA[i] 是马腿在 KING_DELTA[i] 方向时的两个落点
const KNIGHT_DELTA = [-33, -31, -18, 14, -14, 18, 31, 33];
// 从将的位置反查马：马腿在 ADVISOR_DELTA[i] 方向时马可能在的两个位置
const KNIGHT_CHECK_DELTA = [-33, -18, -31, -14, 14, 31, 18, 33];

// ---------------------------------------------------------------------------
// 子力价值表（红方视角，第 0 行是对方底线）。数值为“子力 + 位置”的总分。
// ---------------------------------------------------------------------------

const T_PAWN = [
  [60, 60, 60, 70, 80, 70, 60, 60, 60],
  [130, 160, 190, 215, 225, 215, 190, 160, 130],
  [130, 160, 185, 205, 215, 205, 185, 160, 130],
  [125, 145, 165, 180, 190, 180, 165, 145, 125],
  [115, 125, 135, 150, 155, 150, 135, 125, 115],
  [60, 0, 80, 0, 75, 0, 80, 0, 60],
  [60, 0, 60, 0, 70, 0, 60, 0, 60],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
];

const T_KNIGHT = [
  [410, 420, 440, 440, 420, 440, 440, 420, 410],
  [420, 450, 470, 460, 430, 460, 470, 450, 420],
  [440, 460, 470, 490, 480, 490, 470, 460, 440],
  [440, 470, 480, 490, 495, 490, 480, 470, 440],
  [435, 460, 475, 485, 490, 485, 475, 460, 435],
  [430, 450, 465, 470, 475, 470, 465, 450, 430],
  [420, 430, 445, 450, 455, 450, 445, 430, 420],
  [415, 425, 440, 430, 420, 430, 440, 425, 415],
  [400, 410, 420, 420, 380, 420, 420, 410, 400],
  [390, 395, 410, 410, 400, 410, 410, 395, 390],
];

const T_ROOK = [
  [960, 970, 965, 985, 980, 985, 965, 970, 960],
  [970, 990, 985, 1000, 1010, 1000, 985, 990, 970],
  [960, 975, 970, 990, 990, 990, 970, 975, 960],
  [965, 980, 980, 990, 990, 990, 980, 980, 965],
  [970, 985, 985, 995, 995, 995, 985, 985, 970],
  [965, 980, 980, 990, 990, 990, 980, 980, 965],
  [950, 965, 960, 975, 975, 975, 960, 965, 950],
  [945, 960, 955, 970, 965, 970, 955, 960, 945],
  [940, 960, 955, 970, 960, 970, 955, 960, 940],
  [925, 950, 945, 965, 950, 965, 945, 950, 925],
];

const T_CANNON = [
  [455, 455, 450, 440, 435, 440, 450, 455, 455],
  [450, 450, 445, 440, 430, 440, 445, 450, 450],
  [450, 450, 445, 440, 440, 440, 445, 450, 450],
  [450, 455, 455, 450, 460, 450, 455, 455, 450],
  [450, 450, 450, 450, 465, 450, 450, 450, 450],
  [448, 450, 455, 450, 465, 450, 455, 450, 448],
  [448, 450, 450, 450, 455, 450, 450, 450, 448],
  [450, 450, 455, 460, 475, 460, 455, 450, 450],
  [445, 450, 452, 455, 455, 455, 452, 450, 445],
  [440, 445, 450, 455, 450, 455, 450, 445, 440],
];

function sparseTable(base, entries) {
  const t = [];
  for (let y = 0; y < 10; y++) t.push(new Array(9).fill(base));
  for (const [x, y, v] of entries) t[y][x] = v;
  return t;
}

const T_KING = sparseTable(0, [
  [3, 9, 5], [4, 9, 15], [5, 9, 5],
  [3, 8, -15], [4, 8, -20], [5, 8, -15],
  [3, 7, -30], [4, 7, -40], [5, 7, -30],
]);
const T_ADVISOR = sparseTable(200, [[3, 7, 195], [5, 7, 195], [4, 8, 210]]);
const T_BISHOP = sparseTable(200, [[0, 7, 185], [8, 7, 185], [4, 7, 215], [2, 5, 195], [6, 5, 195]]);

const TABLES = [T_KING, T_ADVISOR, T_BISHOP, T_KNIGHT, T_ROOK, T_CANNON, T_PAWN];
const PST = [];
for (let pc = 0; pc < 24; pc++) PST.push(new Int16Array(256));
for (let t = 0; t < 7; t++) {
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) {
      PST[8 + t][sqOf(x, y)] = TABLES[t][y][x];
      PST[16 + t][sqOf(8 - x, 9 - y)] = TABLES[t][y][x];
    }
  }
}

// 吃子排序用：被吃子越贵越先搜，出手子越便宜越先搜
const ORDER_VALUE = [6, 2, 2, 4, 5, 4, 1];
const TEMPO = 10;

// ---------------------------------------------------------------------------
// Zobrist
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) | 0;
  };
}
const rnd = mulberry32(20240229);
const Z_KEY = new Int32Array(24 * 256);
const Z_LOCK = new Int32Array(24 * 256);
for (let i = 0; i < Z_KEY.length; i++) {
  Z_KEY[i] = rnd();
  Z_LOCK[i] = rnd();
}
const Z_SIDE_KEY = rnd();
const Z_SIDE_LOCK = rnd();

const MAX_HISTORY = 4096;
const FEN_TYPES = { k: KING, a: ADVISOR, b: BISHOP, e: BISHOP, n: KNIGHT, h: KNIGHT, r: ROOK, c: CANNON, p: PAWN };
const FEN_LETTERS = 'kabnrcp';

export class Position {
  constructor(fen = START_FEN) {
    this.sq = new Uint8Array(256);
    this.kingSq = [0, 0];
    this.mvList = new Int32Array(MAX_HISTORY);
    this.pcList = new Uint8Array(MAX_HISTORY);
    this.chkList = new Uint8Array(MAX_HISTORY);
    this.keyList = new Int32Array(MAX_HISTORY);
    this.lockList = new Int32Array(MAX_HISTORY);
    this.contempt = 0;
    this.fromFen(fen);
  }

  fromFen(fen) {
    this.sq.fill(0);
    this.side = RED;
    this.vlRed = 0;
    this.vlBlack = 0;
    this.key = 0;
    this.lock = 0;
    this.hp = 0;   // 历史栈指针
    this.ply = 0;  // 距离搜索根节点的层数
    this.kingSq[0] = this.kingSq[1] = 0;
    const [board, turn] = fen.trim().split(/\s+/);
    const rows = board.split('/');
    for (let y = 0; y < 10; y++) {
      let x = 0;
      for (const ch of rows[y] || '') {
        if (ch >= '1' && ch <= '9') {
          x += +ch;
        } else {
          const t = FEN_TYPES[ch.toLowerCase()];
          if (t !== undefined && x < 9) this.addPiece(sqOf(x, y), (ch === ch.toLowerCase() ? 16 : 8) + t);
          x++;
        }
      }
    }
    if (turn === 'b') this.changeSide();
    return this;
  }

  toFen() {
    const rows = [];
    for (let y = 0; y < 10; y++) {
      let row = '', gap = 0;
      for (let x = 0; x < 9; x++) {
        const pc = this.sq[sqOf(x, y)];
        if (!pc) { gap++; continue; }
        if (gap) { row += gap; gap = 0; }
        const ch = FEN_LETTERS[pc & 7];
        row += pc < 16 ? ch.toUpperCase() : ch;
      }
      rows.push(row + (gap || ''));
    }
    return rows.join('/') + (this.side === RED ? ' w' : ' b');
  }

  addPiece(sq, pc) {
    this.sq[sq] = pc;
    if (pc < 16) this.vlRed += PST[pc][sq]; else this.vlBlack += PST[pc][sq];
    if ((pc & 7) === KING) this.kingSq[pc < 16 ? 0 : 1] = sq;
    this.key ^= Z_KEY[(pc << 8) + sq];
    this.lock ^= Z_LOCK[(pc << 8) + sq];
  }

  delPiece(sq, pc) {
    this.sq[sq] = 0;
    if (pc < 16) this.vlRed -= PST[pc][sq]; else this.vlBlack -= PST[pc][sq];
    this.key ^= Z_KEY[(pc << 8) + sq];
    this.lock ^= Z_LOCK[(pc << 8) + sq];
  }

  changeSide() {
    this.side = 1 - this.side;
    this.key ^= Z_SIDE_KEY;
    this.lock ^= Z_SIDE_LOCK;
  }

  // 走一步。若走后己方被将军（不合法）则撤销并返回 false。
  makeMove(mv) {
    const src = mv & 255, dst = mv >> 8;
    const sq = this.sq;
    const pc = sq[src], cap = sq[dst];
    const key = this.key, lock = this.lock;
    if (cap) this.delPiece(dst, cap);
    this.delPiece(src, pc);
    this.addPiece(dst, pc);
    if (this.checked(this.side)) {
      this.delPiece(dst, pc);
      this.addPiece(src, pc);
      if (cap) this.addPiece(dst, cap);
      return false;
    }
    const hp = this.hp;
    this.mvList[hp] = mv;
    this.pcList[hp] = cap;
    this.keyList[hp] = key;
    this.lockList[hp] = lock;
    this.changeSide();
    this.chkList[hp] = this.checked(this.side) ? 1 : 0;
    this.hp = hp + 1;
    this.ply++;
    return true;
  }

  undoMakeMove() {
    const hp = --this.hp;
    this.ply--;
    this.changeSide();
    const mv = this.mvList[hp], cap = this.pcList[hp];
    const src = mv & 255, dst = mv >> 8;
    const pc = this.sq[dst];
    this.delPiece(dst, pc);
    this.addPiece(src, pc);
    if (cap) this.addPiece(dst, cap);
  }

  nullMove() {
    const hp = this.hp;
    this.mvList[hp] = 0;
    this.pcList[hp] = 0;
    this.keyList[hp] = this.key;
    this.lockList[hp] = this.lock;
    this.chkList[hp] = 0;
    this.changeSide();
    this.hp = hp + 1;
    this.ply++;
  }

  undoNullMove() {
    this.hp--;
    this.ply--;
    this.changeSide();
  }

  // side 一方的将（帅）是否正被攻击（含将帅照面）
  checked(side) {
    const sq = this.sq;
    const k = this.kingSq[side];
    const opp = 16 >> side;
    const fwd = side === RED ? -16 : 16;
    const oppPawn = opp + PAWN;
    if (sq[k + fwd] === oppPawn || sq[k - 1] === oppPawn || sq[k + 1] === oppPawn) return true;
    const oppKnight = opp + KNIGHT;
    for (let i = 0; i < 4; i++) {
      if (sq[k + ADVISOR_DELTA[i]] !== 0) continue;
      if (sq[k + KNIGHT_CHECK_DELTA[i * 2]] === oppKnight || sq[k + KNIGHT_CHECK_DELTA[i * 2 + 1]] === oppKnight) return true;
    }
    const oppRook = opp + ROOK, oppKing = opp + KING, oppCannon = opp + CANNON;
    for (let i = 0; i < 4; i++) {
      const d = KING_DELTA[i];
      let s = k + d;
      while (IN_BOARD[s] && sq[s] === 0) s += d;
      if (!IN_BOARD[s]) continue;
      const pc = sq[s];
      if (pc === oppRook || pc === oppKing) return true;
      s += d;
      while (IN_BOARD[s] && sq[s] === 0) s += d;
      if (IN_BOARD[s] && sq[s] === oppCannon) return true;
    }
    return false;
  }

  inCheck() {
    return this.hp > 0 ? this.chkList[this.hp - 1] !== 0 : this.checked(this.side);
  }

  // 生成伪合法着法（不检查走后是否被将军）。capOnly 时只生成吃子着法。
  generateMoves(capOnly) {
    const sq = this.sq, side = this.side;
    const self = 8 << side, opp = 16 >> side;
    const mvs = [];
    for (let row = 0x30; row <= 0xc0; row += 16) {
      for (let src = row + 3; src <= row + 11; src++) {
        const pc = sq[src];
        if ((pc & self) === 0) continue;
        switch (pc - self) {
          case KING:
            for (let i = 0; i < 4; i++) {
              const dst = src + KING_DELTA[i];
              if (!IN_FORT[dst]) continue;
              const t = sq[dst];
              if (capOnly ? (t & opp) !== 0 : (t & self) === 0) mvs.push(src | (dst << 8));
            }
            break;
          case ADVISOR:
            for (let i = 0; i < 4; i++) {
              const dst = src + ADVISOR_DELTA[i];
              if (!IN_FORT[dst]) continue;
              const t = sq[dst];
              if (capOnly ? (t & opp) !== 0 : (t & self) === 0) mvs.push(src | (dst << 8));
            }
            break;
          case BISHOP:
            for (let i = 0; i < 4; i++) {
              const eye = src + ADVISOR_DELTA[i];
              if (!IN_BOARD[eye] || sq[eye] !== 0) continue;
              const dst = eye + ADVISOR_DELTA[i];
              // 不能过河：终点必须仍在己方半场
              if (!IN_BOARD[dst] || ((dst & 0x80) !== 0) !== (side === RED)) continue;
              const t = sq[dst];
              if (capOnly ? (t & opp) !== 0 : (t & self) === 0) mvs.push(src | (dst << 8));
            }
            break;
          case KNIGHT:
            for (let i = 0; i < 4; i++) {
              const leg = src + KING_DELTA[i];
              if (!IN_BOARD[leg] || sq[leg] !== 0) continue;
              for (let j = 0; j < 2; j++) {
                const dst = src + KNIGHT_DELTA[i * 2 + j];
                if (!IN_BOARD[dst]) continue;
                const t = sq[dst];
                if (capOnly ? (t & opp) !== 0 : (t & self) === 0) mvs.push(src | (dst << 8));
              }
            }
            break;
          case ROOK:
            for (let i = 0; i < 4; i++) {
              const d = KING_DELTA[i];
              let dst = src + d;
              while (IN_BOARD[dst]) {
                const t = sq[dst];
                if (t === 0) {
                  if (!capOnly) mvs.push(src | (dst << 8));
                } else {
                  if ((t & opp) !== 0) mvs.push(src | (dst << 8));
                  break;
                }
                dst += d;
              }
            }
            break;
          case CANNON:
            for (let i = 0; i < 4; i++) {
              const d = KING_DELTA[i];
              let dst = src + d;
              while (IN_BOARD[dst] && sq[dst] === 0) {
                if (!capOnly) mvs.push(src | (dst << 8));
                dst += d;
              }
              if (!IN_BOARD[dst]) continue;
              dst += d;
              while (IN_BOARD[dst]) {
                const t = sq[dst];
                if (t !== 0) {
                  if ((t & opp) !== 0) mvs.push(src | (dst << 8));
                  break;
                }
                dst += d;
              }
            }
            break;
          case PAWN: {
            let dst = src + (side === RED ? -16 : 16);
            if (IN_BOARD[dst]) {
              const t = sq[dst];
              if (capOnly ? (t & opp) !== 0 : (t & self) === 0) mvs.push(src | (dst << 8));
            }
            // 过河后可以横走
            if (((src & 0x80) !== 0) !== (side === RED)) {
              for (let d = -1; d <= 1; d += 2) {
                dst = src + d;
                if (!IN_BOARD[dst]) continue;
                const t = sq[dst];
                if (capOnly ? (t & opp) !== 0 : (t & self) === 0) mvs.push(src | (dst << 8));
              }
            }
            break;
          }
        }
      }
    }
    return mvs;
  }

  legalMoves() {
    const out = [];
    for (const mv of this.generateMoves(false)) {
      if (this.makeMove(mv)) {
        this.undoMakeMove();
        out.push(mv);
      }
    }
    return out;
  }

  isLegal(mv) {
    return this.legalMoves().includes(mv);
  }

  hasLegalMove() {
    for (const mv of this.generateMoves(false)) {
      if (this.makeMove(mv)) {
        this.undoMakeMove();
        return true;
      }
    }
    return false;
  }

  // 走子方视角的静态评分
  evaluate() {
    const v = this.vlRed - this.vlBlack;
    return (this.side === RED ? v : -v) + TEMPO;
  }

  // 空着裁剪的条件：己方子力足够，不容易出现无等着可走的局面
  nullOkay() {
    return (this.side === RED ? this.vlRed : this.vlBlack) > 1200;
  }

  nullSafe() {
    return (this.side === RED ? this.vlRed : this.vlBlack) > 2500;
  }

  // 重复局面检测。返回 0 表示无重复；否则 1 + (己方长将 ? 2 : 0) + (对方长将 ? 4 : 0)。
  // recur：需要回溯到第几次相同局面（搜索中用 1，对局裁决用 2 即“三次重复”）。
  repStatus(recur) {
    let selfSide = false, perp = true, oppPerp = true;
    let i = this.hp - 1;
    while (i >= 0 && this.mvList[i] !== 0 && this.pcList[i] === 0) {
      if (selfSide) {
        perp = perp && this.chkList[i] !== 0;
        if (this.keyList[i] === this.key && this.lockList[i] === this.lock) {
          if (--recur === 0) return 1 + (perp ? 2 : 0) + (oppPerp ? 4 : 0);
        }
      } else {
        oppPerp = oppPerp && this.chkList[i] !== 0;
      }
      selfSide = !selfSide;
      i--;
    }
    return 0;
  }

  repValue(status) {
    const vl = ((status & 2) ? this.ply - BAN : 0) + ((status & 4) ? BAN - this.ply : 0);
    return vl === 0 ? this.drawValue() : vl;
  }

  drawValue() {
    return (this.ply & 1) === 0 ? -this.contempt : this.contempt;
  }

  // 距离上一次吃子已经走了多少步（半回合）
  pliesSinceCapture() {
    let n = 0;
    for (let i = this.hp - 1; i >= 0 && this.pcList[i] === 0; i--) n++;
    return n;
  }

  // 双方都没有能过河进攻的子力（车马炮兵）
  noAttackers() {
    for (let sq = 0x33; sq <= 0xcb; sq++) {
      if (this.sq[sq] !== 0 && (this.sq[sq] & 7) >= KNIGHT) return false;
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// 坐标记法（ICCS）：a-i 为红方左到右，0-9 为红方底线到黑方底线，如 h2e2
// ---------------------------------------------------------------------------

export function moveToIccs(mv) {
  const s = mv & 255, d = mv >> 8;
  const f = (sq) => String.fromCharCode(97 + sqX(sq)) + (9 - sqY(sq));
  return f(s) + f(d);
}

export function iccsToMove(str) {
  const f = (i) => sqOf(str.charCodeAt(i) - 97, 9 - (str.charCodeAt(i + 1) - 48));
  return makeMv(f(0), f(2));
}

// ---------------------------------------------------------------------------
// 搜索：迭代加深 + PVS + 置换表 + 空着裁剪 + 静态搜索 + 杀手/历史启发
// ---------------------------------------------------------------------------

const HASH_ALPHA = 1, HASH_BETA = 2, HASH_PV = 3;
const LIMIT_PLY = 64;
const NULL_R = 2;
const NONE = -32768;
const now = () => performance.now();

export class Search {
  constructor(hashBits = 20) {
    const size = 1 << hashBits;
    this.mask = size - 1;
    this.ttLock = new Int32Array(size);
    this.ttVl = new Int16Array(size);
    this.ttDepth = new Int8Array(size);
    this.ttFlag = new Uint8Array(size);
    this.ttMv = new Uint16Array(size);
    this.history = new Int32Array(65536);
    this.killers = new Int32Array((LIMIT_PLY + 2) * 2);
    this.pv = [];
    for (let i = 0; i < LIMIT_PLY + 2; i++) this.pv.push(new Int32Array(LIMIT_PLY + 2));
    this.pvLen = new Int32Array(LIMIT_PLY + 2);
    this.pos = null;
    this.nodes = 0;
    this.stop = false;
    this.canStop = false;
    this.hashMv = 0;
  }

  clear() {
    this.ttFlag.fill(0);
    this.ttLock.fill(0);
  }

  probe(alpha, beta, depth) {
    const pos = this.pos;
    const i = pos.key & this.mask;
    if (this.ttFlag[i] === 0 || this.ttLock[i] !== pos.lock) {
      this.hashMv = 0;
      return NONE;
    }
    this.hashMv = this.ttMv[i];
    let vl = this.ttVl[i];
    let mate = false;
    if (vl > WIN) {
      if (vl <= BAN) return NONE; // 长将分值与路径有关，不能复用
      vl -= pos.ply;
      mate = true;
    } else if (vl < -WIN) {
      if (vl >= -BAN) return NONE;
      vl += pos.ply;
      mate = true;
    }
    if (this.ttDepth[i] >= depth || mate) {
      const flag = this.ttFlag[i];
      if (flag === HASH_BETA) return vl >= beta ? vl : NONE;
      if (flag === HASH_ALPHA) return vl <= alpha ? vl : NONE;
      return vl;
    }
    return NONE;
  }

  record(flag, vl, depth, mv) {
    const pos = this.pos;
    const i = pos.key & this.mask;
    if (vl > WIN) vl += pos.ply;
    else if (vl < -WIN) vl -= pos.ply;
    if (mv === 0 && this.ttFlag[i] !== 0 && this.ttLock[i] === pos.lock) mv = this.ttMv[i];
    this.ttLock[i] = pos.lock;
    this.ttVl[i] = vl;
    this.ttDepth[i] = depth;
    this.ttFlag[i] = flag;
    this.ttMv[i] = mv;
  }

  checkTime() {
    if (this.canStop && now() - this.startTime > this.timeMs) this.stop = true;
  }

  mvvLva(mv) {
    const sq = this.pos.sq;
    return ORDER_VALUE[sq[mv >> 8] & 7] * 8 - ORDER_VALUE[sq[mv & 255] & 7];
  }

  quiesce(alpha, beta) {
    const pos = this.pos;
    const ply = pos.ply;
    this.pvLen[ply] = 0;
    if ((++this.nodes & 2047) === 0) this.checkTime();
    const rep = pos.repStatus(1);
    if (rep) return pos.repValue(rep);
    if (ply >= LIMIT_PLY) return pos.evaluate();

    let best = -MATE;
    let mvs;
    const vals = [];
    if (pos.inCheck()) {
      mvs = pos.generateMoves(false);
      for (let i = 0; i < mvs.length; i++) {
        const mv = mvs[i];
        vals.push(pos.sq[mv >> 8] ? (1 << 24) + this.mvvLva(mv) : this.history[mv]);
      }
    } else {
      const vl = pos.evaluate();
      if (vl >= beta) return vl;
      best = vl;
      if (vl > alpha) alpha = vl;
      mvs = pos.generateMoves(true);
      for (let i = 0; i < mvs.length; i++) vals.push(this.mvvLva(mvs[i]));
    }

    const n = mvs.length;
    for (let i = 0; i < n; i++) {
      let bi = i;
      for (let j = i + 1; j < n; j++) if (vals[j] > vals[bi]) bi = j;
      const mv = mvs[bi];
      mvs[bi] = mvs[i]; vals[bi] = vals[i];
      if (!pos.makeMove(mv)) continue;
      const vl = -this.quiesce(-beta, -alpha);
      pos.undoMakeMove();
      if (this.stop) return 0;
      if (vl > best) {
        best = vl;
        if (vl > alpha) {
          alpha = vl;
          this.updatePv(ply, mv);
          if (vl >= beta) break;
        }
      }
    }
    return best === -MATE ? ply - MATE : best;
  }

  updatePv(ply, mv) {
    const line = this.pv[ply], child = this.pv[ply + 1];
    const n = this.pvLen[ply + 1];
    line[0] = mv;
    for (let i = 0; i < n; i++) line[i + 1] = child[i];
    this.pvLen[ply] = n + 1;
  }

  search(alpha, beta, depth, noNull) {
    if (depth <= 0) return this.quiesce(alpha, beta);
    const pos = this.pos;
    const ply = pos.ply;
    this.pvLen[ply] = 0;
    if ((++this.nodes & 2047) === 0) this.checkTime();

    const rep = pos.repStatus(1);
    if (rep) return pos.repValue(rep);
    if (ply >= LIMIT_PLY) return pos.evaluate();

    const isPV = beta - alpha > 1;
    let vl = this.probe(alpha, beta, depth);
    const hashMv = this.hashMv;
    if (vl !== NONE && !isPV) return vl;

    const inCheck = pos.inCheck();
    if (!isPV && !noNull && !inCheck && pos.nullOkay()) {
      pos.nullMove();
      vl = -this.search(-beta, 1 - beta, depth - 1 - NULL_R, true);
      pos.undoNullMove();
      if (this.stop) return 0;
      if (vl >= beta) {
        if (vl > WIN) vl = beta;
        if (pos.nullSafe() || this.search(beta - 1, beta, depth - NULL_R, true) >= beta) return vl;
        if (this.stop) return 0;
      }
    }

    const mvs = pos.generateMoves(false);
    const n = mvs.length;
    const vals = new Array(n);
    const k1 = this.killers[ply * 2], k2 = this.killers[ply * 2 + 1];
    for (let i = 0; i < n; i++) {
      const mv = mvs[i];
      if (mv === hashMv) vals[i] = 1 << 30;
      else if (pos.sq[mv >> 8] !== 0) vals[i] = (1 << 24) + this.mvvLva(mv);
      else if (mv === k1) vals[i] = (1 << 23) + 1;
      else if (mv === k2) vals[i] = 1 << 23;
      else vals[i] = this.history[mv];
    }

    let best = -MATE, bestMv = 0, flag = HASH_ALPHA, legal = 0;
    for (let i = 0; i < n; i++) {
      let bi = i;
      for (let j = i + 1; j < n; j++) if (vals[j] > vals[bi]) bi = j;
      const mv = mvs[bi];
      const val = vals[bi];
      mvs[bi] = mvs[i]; vals[bi] = vals[i];
      if (!pos.makeMove(mv)) continue;
      legal++;
      const givesCheck = pos.inCheck();
      const newDepth = givesCheck ? depth : depth - 1;
      if (legal === 1) {
        vl = -this.search(-beta, -alpha, newDepth, false);
      } else {
        // 靠后的安静着法先浅搜，超出预期再按原深度重搜
        let r = 0;
        if (depth >= 3 && legal > 3 && !inCheck && !givesCheck && val < (1 << 23)) r = legal > 12 && depth >= 5 ? 2 : 1;
        vl = -this.search(-alpha - 1, -alpha, newDepth - r, false);
        if (r > 0 && vl > alpha && !this.stop) vl = -this.search(-alpha - 1, -alpha, newDepth, false);
        if (vl > alpha && vl < beta && !this.stop) vl = -this.search(-beta, -alpha, newDepth, false);
      }
      pos.undoMakeMove();
      if (this.stop) return 0;
      if (vl > best) {
        best = vl;
        if (vl > alpha) {
          alpha = vl;
          bestMv = mv;
          flag = HASH_PV;
          this.updatePv(ply, mv);
          if (vl >= beta) {
            flag = HASH_BETA;
            break;
          }
        }
      }
    }

    if (legal === 0) return ply - MATE; // 被将死或困毙都判负
    if (bestMv !== 0 && pos.sq[bestMv >> 8] === 0) {
      const h = (this.history[bestMv] += depth * depth);
      if (h > (1 << 22)) for (let i = 0; i < 65536; i++) this.history[i] >>= 1;
      if (this.killers[ply * 2] !== bestMv) {
        this.killers[ply * 2 + 1] = this.killers[ply * 2];
        this.killers[ply * 2] = bestMv;
      }
    }
    this.record(flag, best, depth, bestMv);
    return best;
  }

  // 根节点搜索。
  // opts: timeMs 思考时间上限；maxDepth 最大深度；minDepth 至少搜完的深度；
  //       searchMoves 只考虑这些根着法；single 只有唯一应着时立即返回。
  searchRoot(pos, opts = {}) {
    const { timeMs = 1000, maxDepth = LIMIT_PLY - 2, minDepth = 1, searchMoves = null, single = false } = opts;
    this.pos = pos;
    pos.ply = 0;
    this.startTime = now();
    this.timeMs = timeMs;
    this.stop = false;
    this.canStop = false;
    this.nodes = 0;
    this.history.fill(0);
    this.killers.fill(0);

    let root = pos.legalMoves();
    if (searchMoves) root = root.filter((m) => searchMoves.includes(m));
    const result = { move: 0, score: -MATE, depth: 0, pv: [], nodes: 0 };
    if (root.length === 0) return result;
    root.sort((a, b) => (pos.sq[b >> 8] ? this.mvvLva(b) + 100 : 0) - (pos.sq[a >> 8] ? this.mvvLva(a) + 100 : 0));
    result.move = root[0];
    result.pv = [root[0]];

    for (let depth = 1; depth <= maxDepth; depth++) {
      let alpha = -MATE, best = -MATE, bestMv = 0, bestPv = null;
      for (let i = 0; i < root.length; i++) {
        const mv = root[i];
        pos.makeMove(mv);
        const nd = pos.inCheck() ? depth : depth - 1;
        let vl;
        if (i === 0) {
          vl = -this.search(-MATE, MATE, nd, false);
        } else {
          vl = -this.search(-alpha - 1, -alpha, nd, false);
          if (!this.stop && vl > alpha) vl = -this.search(-MATE, -alpha, nd, false);
        }
        pos.undoMakeMove();
        if (this.stop) break;
        if (vl > best) {
          best = vl;
          bestMv = mv;
          alpha = vl;
          bestPv = [mv];
          for (let j = 0; j < this.pvLen[1]; j++) bestPv.push(this.pv[1][j]);
        }
      }
      if (bestMv !== 0) {
        result.move = bestMv;
        result.score = best;
        result.depth = depth;
        result.pv = bestPv;
        const idx = root.indexOf(bestMv);
        root.splice(idx, 1);
        root.unshift(bestMv);
      }
      if (this.stop) break;
      this.canStop = depth >= minDepth;
      if (best > WIN || best < -WIN) break;
      if (single && root.length === 1) break;
      if (now() - this.startTime > timeMs * 0.6) break;
    }
    result.nodes = this.nodes;
    return result;
  }

  // 低难度用：每个根着法都按固定深度完整搜索，再从“差不多好”的着法里随机挑一个。
  searchRandom(pos, depth, margin) {
    this.pos = pos;
    pos.ply = 0;
    this.stop = false;
    this.canStop = false;
    this.nodes = 0;
    this.history.fill(0);
    this.killers.fill(0);
    const scored = [];
    let best = -MATE;
    for (const mv of pos.legalMoves()) {
      pos.makeMove(mv);
      const vl = -this.search(-MATE, MATE, pos.inCheck() ? depth : depth - 1, false);
      pos.undoMakeMove();
      scored.push([mv, vl]);
      if (vl > best) best = vl;
    }
    if (scored.length === 0) return { move: 0, score: -MATE, depth, pv: [], nodes: this.nodes };
    // 能杀就杀、会被杀就不走，不拿胜负开玩笑
    const slack = best > WIN ? 0 : margin;
    const pool = scored.filter(([, vl]) => vl >= best - slack && (vl > -WIN || best < -WIN));
    const [move, score] = pool[Math.floor(Math.random() * pool.length)];
    return { move, score, depth, pv: [move], nodes: this.nodes };
  }
}

// 从初始 FEN 和着法序列恢复局面（保留历史，供重复局面检测）
export function positionFromMoves(fen, moves) {
  const pos = new Position(fen || START_FEN);
  for (const mv of moves) {
    if (!pos.makeMove(mv)) throw new Error('illegal move in history: ' + moveToIccs(mv));
  }
  pos.ply = 0;
  return pos;
}
