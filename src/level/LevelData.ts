import type { Platform } from '../entities/Player';

export const GRID = 32; // 정사각형 블록 한 칸(px)

export type MoverMode = 'horizontal' | 'vertical';
export interface CellPos { c: number; r: number; }
export interface LevelMover {
  c: number; r: number; len: number;   // 좌상단 칸 + 가로 길이(칸)
  mode: MoverMode; range: number; period: number; // range=칸 단위 진폭, period=초
}

export type EnemyKind = 'patrol' | 'charger';
/** 적 배치: 발이 r*GRID 높이(=해당 칸 윗면)에 놓임 */
export interface LevelEnemy { c: number; r: number; kind: EnemyKind; }

export interface LevelData {
  cols: number;
  rows: number;
  solid: boolean[];      // cols*rows, 채워진 블록 여부
  spawn: CellPos;        // 플레이어 시작(발이 r*GRID, 중심 c칸)
  goal: CellPos;         // 정상 깃발 위치(칸)
  traps: CellPos[];      // 가시 함정 칸
  movers: LevelMover[];
  enemies: LevelEnemy[];
}

const STORAGE_KEY = 'hop_level_v2';

export const worldW = (lv: LevelData) => lv.cols * GRID;
export const worldH = (lv: LevelData) => lv.rows * GRID;

/** 기본 레벨: 바닥 + 좌우 벽 + 지그재그 계단 + 이동발판 + 함정 */
export function defaultLevel(): LevelData {
  const cols = 30, rows = 44; // 960 x 1408
  const solid = new Array(cols * rows).fill(false);
  const set = (c: number, r: number) => {
    if (c >= 0 && c < cols && r >= 0 && r < rows) solid[r * cols + c] = true;
  };

  for (let c = 0; c < cols; c++) { set(c, rows - 1); set(c, rows - 2); } // 바닥 2줄
  for (let r = 0; r < rows; r++) { set(0, r); set(cols - 1, r); }       // 좌우 벽

  // 지그재그 계단 (2칸 위로, 2칸 옆으로, 폭 3칸 → 겹쳐서 오르기 쉬움)
  let r = rows - 4, c = 4, dir = 1;
  while (r > 4) {
    for (let k = 0; k < 3; k++) set(c + k, r);
    r -= 2;
    c += dir * 2;
    if (c + 3 >= cols - 1) dir = -1;
    if (c <= 1) dir = 1;
  }
  // 정상 발판 (깃발 받침)
  for (let k = -2; k <= 2; k++) set(14 + k, 4);

  return {
    cols, rows, solid,
    spawn: { c: 14, r: rows - 2 },
    goal: { c: 14, r: 3 },
    traps: [{ c: 16, r: rows - 3 }, { c: 17, r: rows - 3 }],
    movers: [
      { c: 12, r: 30, len: 3, mode: 'horizontal', range: 4, period: 3.2 },
      { c: 22, r: 24, len: 3, mode: 'vertical', range: 4, period: 3.6 },
    ],
    // 계단 중간중간 순찰자, 바닥에 돌진자 하나
    enemies: [
      { c: 5, r: rows - 2, kind: 'charger' },
      { c: 7, r: 38, kind: 'patrol' },
      { c: 13, r: 32, kind: 'patrol' },
      { c: 21, r: 24, kind: 'patrol' },
      { c: 27, r: 18, kind: 'patrol' },
    ],
  };
}

export function loadLevel(): LevelData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch { /* 손상 시 기본 레벨 */ }
  return defaultLevel();
}

/** 저장된(옛 포맷 포함) 데이터를 안전한 LevelData로 보정 */
function normalize(o: Partial<LevelData> & { goalRow?: number }): LevelData {
  const base = defaultLevel();
  const cols = o.cols ?? base.cols;
  const rows = o.rows ?? base.rows;
  const solid = Array.isArray(o.solid) && o.solid.length === cols * rows
    ? o.solid : new Array(cols * rows).fill(false);
  return {
    cols, rows, solid,
    spawn: o.spawn ?? base.spawn,
    goal: o.goal ?? { c: Math.floor(cols / 2), r: o.goalRow ?? 3 },
    traps: Array.isArray(o.traps) ? o.traps : [],
    movers: Array.isArray(o.movers) ? o.movers : [],
    enemies: Array.isArray(o.enemies) ? o.enemies : [],
  };
}

export function saveLevel(lv: LevelData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lv));
}

// ── 맵 코드(복붙 공유) ── 슈퍼마리오메이커 코스코드처럼 ──

function packSolid(solid: boolean[]): string {
  const bytes: number[] = [];
  for (let i = 0; i < solid.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) if (solid[i + j]) b |= 1 << j;
    bytes.push(b);
  }
  return btoa(String.fromCharCode(...bytes));
}

function unpackSolid(s: string, len: number): boolean[] {
  const bin = atob(s);
  const solid = new Array(len).fill(false);
  for (let i = 0; i < len; i++) {
    solid[i] = !!(bin.charCodeAt(i >> 3) & (1 << (i & 7)));
  }
  return solid;
}

/** 레벨 → 복붙용 코드 문자열 */
export function encodeLevel(lv: LevelData): string {
  const obj = {
    c: lv.cols, r: lv.rows,
    sp: [lv.spawn.c, lv.spawn.r], g: [lv.goal.c, lv.goal.r],
    t: lv.traps.map((t) => [t.c, t.r]),
    m: lv.movers.map((m) => [m.c, m.r, m.len, m.mode === 'horizontal' ? 0 : 1, m.range, m.period]),
    e: lv.enemies.map((e) => [e.c, e.r, e.kind === 'patrol' ? 0 : 1]),
    s: packSolid(lv.solid),
  };
  return 'HOP1' + btoa(JSON.stringify(obj));
}

/** 코드 문자열 → 레벨 (실패 시 null) */
export function decodeLevel(code: string): LevelData | null {
  try {
    const body = code.trim().replace(/^HOP1/, '');
    const o = JSON.parse(atob(body));
    return {
      cols: o.c, rows: o.r,
      solid: unpackSolid(o.s, o.c * o.r),
      spawn: { c: o.sp[0], r: o.sp[1] },
      goal: { c: o.g[0], r: o.g[1] },
      traps: o.t.map(([c, r]: number[]) => ({ c, r })),
      movers: o.m.map(([c, r, len, md, range, period]: number[]): LevelMover => ({
        c, r, len, mode: md ? 'vertical' : 'horizontal', range, period,
      })),
      // 옛 코드(HOP1 초기 버전)엔 e 필드가 없음 → 적 없는 맵으로 로드
      enemies: (o.e ?? []).map(([c, r, k]: number[]): LevelEnemy => ({
        c, r, kind: k ? 'charger' : 'patrol',
      })),
    };
  } catch {
    return null;
  }
}

/** 솔리드 그리드에서 '윗면이 노출된' 칸을 one-way 발판 세그먼트로 추출 (함정 칸 제외) */
export function deriveSurfaces(lv: LevelData): Platform[] {
  const { cols, rows, solid } = lv;
  const trapSet = new Set(lv.traps.map((t) => t.r * cols + t.c));
  const segs: Platform[] = [];
  for (let r = 0; r < rows; r++) {
    let start = -1;
    for (let c = 0; c <= cols; c++) {
      const exposedTop =
        c < cols &&
        solid[r * cols + c] &&
        !(r > 0 && solid[(r - 1) * cols + c]) &&
        !trapSet.has(r * cols + c);
      if (exposedTop && start < 0) start = c;
      else if (!exposedTop && start >= 0) {
        segs.push({ x: start * GRID, y: r * GRID, w: (c - start) * GRID });
        start = -1;
      }
    }
  }
  return segs;
}
