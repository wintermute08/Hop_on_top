import Phaser from 'phaser';
import {
  GRID, loadLevel, saveLevel, defaultLevel, worldW, worldH,
  encodeLevel, decodeLevel,
  type LevelData, type LevelMover,
} from '../level/LevelData';

type Brush = 'block' | 'trap' | 'moverH' | 'moverV' | 'spawn' | 'goal' | 'erase';
const BRUSH_KEYS: { key: number; brush: Brush; label: string }[] = [
  { key: Phaser.Input.Keyboard.KeyCodes.ONE,   brush: 'block',  label: '1 블록' },
  { key: Phaser.Input.Keyboard.KeyCodes.TWO,   brush: 'trap',   label: '2 함정' },
  { key: Phaser.Input.Keyboard.KeyCodes.THREE, brush: 'moverH', label: '3 이동(↔)' },
  { key: Phaser.Input.Keyboard.KeyCodes.FOUR,  brush: 'moverV', label: '4 이동(↕)' },
  { key: Phaser.Input.Keyboard.KeyCodes.FIVE,  brush: 'spawn',  label: '5 시작' },
  { key: Phaser.Input.Keyboard.KeyCodes.SIX,   brush: 'goal',   label: '6 정상' },
  { key: Phaser.Input.Keyboard.KeyCodes.ZERO,  brush: 'erase',  label: '0 지우개' },
];

export class EditorScene extends Phaser.Scene {
  private level!: LevelData;
  private gfx!: Phaser.GameObjects.Graphics;
  private overlay!: Phaser.GameObjects.Container; // 마커(시작/정상/이동) 텍스트류
  private hud!: Phaser.GameObjects.Text;
  private brush: Brush = 'block';
  private painting = false;
  private paintValue = true; // 블록 드래그 시 채울지/지울지

  constructor() {
    super({ key: 'EditorScene' });
  }

  create(): void {
    this.level = loadLevel();
    const ww = worldW(this.level), wh = worldH(this.level);

    this.add.rectangle(ww / 2, wh / 2, ww, wh, 0xffffff).setDepth(-10);
    this.gfx = this.add.graphics();
    this.overlay = this.add.container();

    this.cameras.main.setBounds(0, 0, ww, wh);
    this.cameras.main.scrollY = wh - this.scale.height; // 바닥부터 보기

    // 브러시 선택
    BRUSH_KEYS.forEach(({ key, brush }) =>
      this.input.keyboard!.addKey(key).on('down', () => { this.brush = brush; this.redraw(); }),
    );
    // 저장 / 리셋 / 플레이
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S).on('down', () => this.flashSaved());
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.R).on('down', () => {
      this.level = defaultLevel(); this.persist(); this.redraw();
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E).on('down', () => this.toPlay());
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER).on('down', () => this.toPlay());
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.M).on('down', () => {
      this.persist(); this.scene.start('MenuScene');
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.K).on('down', () => this.copyCode());
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.L).on('down', () => this.loadCode());

    // 카메라 스크롤
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      this.cameras.main.scrollY = Phaser.Math.Clamp(
        this.cameras.main.scrollY + dy * 0.5, 0, wh - this.scale.height,
      );
    });

    // 포인터 편집
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onDown(p));
    this.input.on('pointerup', () => { this.painting = false; this.persist(); });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => { if (this.painting) this.paint(p); });

    // HUD (화면 고정)
    this.hud = this.add.text(8, 8, '', {
      fontSize: '11px', color: '#222222', fontFamily: 'monospace',
    }).setScrollFactor(0).setDepth(1000);

    this.redraw();
  }

  private cellAt(p: Phaser.Input.Pointer): { c: number; r: number } {
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    return { c: Math.floor(wp.x / GRID), r: Math.floor(wp.y / GRID) };
  }

  private inBounds(c: number, r: number): boolean {
    return c >= 0 && c < this.level.cols && r >= 0 && r < this.level.rows;
  }

  private onDown(p: Phaser.Input.Pointer): void {
    const { c, r } = this.cellAt(p);
    if (!this.inBounds(c, r)) return;
    const erase = this.brush === 'erase' || p.rightButtonDown();

    switch (this.brush) {
      case 'block':
        this.painting = true;
        this.paintValue = !erase ? !this.isSolid(c, r) : false; // 빈칸→채우기, 찬칸→지우기
        this.setSolid(c, r, this.paintValue);
        break;
      case 'trap':
        erase ? this.removeTrap(c, r) : this.addTrap(c, r);
        break;
      case 'moverH':
      case 'moverV':
        erase ? this.removeMover(c, r) : this.addMover(c, r, this.brush === 'moverH' ? 'horizontal' : 'vertical');
        break;
      case 'spawn':
        this.level.spawn = { c, r };
        break;
      case 'goal':
        this.level.goal = { c, r };
        break;
      case 'erase':
        this.eraseAny(c, r);
        this.painting = true;
        break;
    }
    this.redraw();
  }

  private paint(p: Phaser.Input.Pointer): void {
    const { c, r } = this.cellAt(p);
    if (!this.inBounds(c, r)) return;
    if (this.brush === 'block') this.setSolid(c, r, this.paintValue);
    else if (this.brush === 'erase') this.eraseAny(c, r);
    this.redraw();
  }

  private eraseAny(c: number, r: number): void {
    this.setSolid(c, r, false);
    this.removeTrap(c, r);
    this.removeMover(c, r);
  }

  // ── 데이터 조작 ──
  private isSolid(c: number, r: number): boolean { return this.level.solid[r * this.level.cols + c]; }
  private setSolid(c: number, r: number, v: boolean): void { this.level.solid[r * this.level.cols + c] = v; }
  private addTrap(c: number, r: number): void {
    if (!this.level.traps.some((t) => t.c === c && t.r === r)) this.level.traps.push({ c, r });
  }
  private removeTrap(c: number, r: number): void {
    this.level.traps = this.level.traps.filter((t) => !(t.c === c && t.r === r));
  }
  private addMover(c: number, r: number, mode: LevelMover['mode']): void {
    this.level.movers.push({ c, r, len: 3, mode, range: 4, period: 3.2 });
  }
  private removeMover(c: number, r: number): void {
    this.level.movers = this.level.movers.filter(
      (m) => !(r === m.r && c >= m.c && c < m.c + m.len),
    );
  }

  private persist(): void { saveLevel(this.level); }
  private flashSaved(): void { this.persist(); this.hud.setText(this.hudText() + '   ✔ 저장됨'); }
  private toPlay(): void { this.persist(); this.scene.start('GameScene'); }

  private copyCode(): void {
    const code = encodeLevel(this.level);
    navigator.clipboard?.writeText(code).catch(() => { /* prompt로 대체 */ });
    window.prompt('맵 코드 (복사해서 공유하세요):', code);
  }

  private loadCode(): void {
    const code = window.prompt('맵 코드를 붙여넣으세요:');
    if (!code) return;
    const lv = decodeLevel(code);
    if (!lv) { window.alert('잘못된 맵 코드예요.'); return; }
    this.level = lv;
    this.persist();
    this.redraw();
  }

  private hudText(): string {
    const list = BRUSH_KEYS.map((b) => (b.brush === this.brush ? `[${b.label}]` : b.label)).join('  ');
    return `브러시: ${list}\n좌클릭 칠하기 / 우클릭·0 지우기 · 휠 스크롤 · S 저장 · R 초기화 · K 코드복사 · L 코드불러오기 · E 플레이 · M 메뉴`;
  }

  // ── 렌더 ──
  private redraw(): void {
    const { cols, rows, solid } = this.level;
    const g = this.gfx;
    g.clear();
    this.overlay.removeAll(true);

    // 그리드
    g.lineStyle(1, 0xe2e2e2, 1);
    for (let c = 0; c <= cols; c++) g.lineBetween(c * GRID, 0, c * GRID, rows * GRID);
    for (let r = 0; r <= rows; r++) g.lineBetween(0, r * GRID, cols * GRID, r * GRID);

    // 블록
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!solid[r * cols + c]) continue;
      g.fillStyle(0x6f7e93, 1).fillRect(c * GRID, r * GRID, GRID, GRID);
      g.lineStyle(2, 0x3c4654, 1).strokeRect(c * GRID, r * GRID, GRID, GRID);
    }

    // 함정
    g.fillStyle(0xd83a3a, 1);
    this.level.traps.forEach((t) => {
      const x = t.c * GRID, top = t.r * GRID, base = (t.r + 1) * GRID;
      g.fillTriangle(x, base, x + GRID / 2, top, x + GRID, base);
    });

    // 이동 발판
    this.level.movers.forEach((m) => {
      g.fillStyle(0xc9a063, 1).fillRect(m.c * GRID, m.r * GRID, m.len * GRID, GRID);
      g.lineStyle(2, 0x8a6a30, 1).strokeRect(m.c * GRID, m.r * GRID, m.len * GRID, GRID);
      this.overlay.add(this.add.text(
        m.c * GRID + (m.len * GRID) / 2, m.r * GRID + GRID / 2,
        m.mode === 'horizontal' ? '↔' : '↕',
        { fontSize: '16px', color: '#5a3d10', fontFamily: 'monospace' },
      ).setOrigin(0.5));
    });

    // 시작점
    const sx = this.level.spawn.c * GRID + GRID / 2, sy = this.level.spawn.r * GRID;
    g.fillStyle(0x3fa34d, 1).fillCircle(sx, sy, 7);
    this.overlay.add(this.add.text(sx, sy - 18, 'START', {
      fontSize: '10px', color: '#1f6b2c', fontFamily: 'monospace',
    }).setOrigin(0.5));

    // 정상 깃발
    const gx = this.level.goal.c * GRID + GRID / 2, gy = (this.level.goal.r + 1) * GRID;
    g.lineStyle(3, 0x555555, 1);
    g.lineBetween(gx, gy, gx, gy - GRID * 1.4);
    g.fillStyle(0xff4444, 1);
    g.fillTriangle(gx, gy - GRID * 1.4, gx + 22, gy - GRID * 1.4 + 8, gx, gy - GRID * 1.4 + 16);

    this.hud.setText(this.hudText());
  }
}
