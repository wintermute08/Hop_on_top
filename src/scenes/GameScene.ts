import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { Dummy } from '../entities/Dummy';
import { MovingPlatform } from '../entities/MovingPlatform';
import { CameraController } from '../systems/CameraController';
import { TouchControls } from '../systems/TouchControls';
import { GRID, loadLevel, deriveSurfaces, worldW, worldH, type LevelData } from '../level/LevelData';

interface Trap { x: number; y: number; w: number; h: number; }

const COMBO_WINDOW = 1.2;
const PLAT_VIS_H = GRID;
const BLOCK_FILL = 0x6f7e93;
const BLOCK_EDGE = 0x3c4654;
const PALETTE = [0xe0a0d8, 0xe08585, 0x8fb8e8, 0xa8d8a0, 0xe8d888, 0xe8b088];

/** 검은 실루엣 텍스처를 흰색으로 변환 — tint(곱셈)로 어떤 색이든 입힐 수 있게 */
function whitenTexture(scene: Phaser.Scene, key: string): void {
  const img = scene.textures.get(key).getSourceImage() as HTMLImageElement;
  const w = img.width, h = img.height;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  scene.textures.remove(key);
  scene.textures.addCanvas(key, canvas);
}

export class GameScene extends Phaser.Scene {
  private level!: LevelData;
  private player!: Player;
  private dummy!: Dummy;
  private camCtl!: CameraController;
  private touchControls!: TouchControls;
  private hitParticles!: Phaser.GameObjects.Particles.ParticleEmitter;
  private hitStop = 0;
  private comboCount = 0;
  private comboTimer = 0;
  private colorIndex = 0;
  private movingPlatforms: MovingPlatform[] = [];
  private traps: Trap[] = [];
  private checkpoint = { x: 0, y: 0 };
  private wWidth = 0;
  private wHeight = 0;
  private goalRect = { x: 0, y: 0, w: 0, h: 0 };
  private won = false;

  constructor() {
    super({ key: 'GameScene' });
  }

  preload(): void {
    for (let i = 0; i < 8; i++) {
      this.load.image(`walk_${i}`,     `assets/sprites/walk/frame_${i}.png`);
      this.load.image(`run_${i}`,      `assets/sprites/run/frame_${i}.png`);
      this.load.image(`run_jump_${i}`, `assets/sprites/run_jump/frame_${i}.png`);
    }
    for (let i = 0; i < 9; i++) this.load.image(`jump_${i}`, `assets/sprites/jump/frame_${i}.png`);
    for (let i = 0; i < 6; i++) this.load.image(`punch_${i}`, `assets/sprites/punch/frame_${i}.png`);
    for (let i = 0; i < 3; i++) this.load.image(`jab_${i}`, `assets/sprites/jab/frame_${i}.png`);
  }

  create(): void {
    // 캐릭터 실루엣을 흰색으로 변환(색 입히기 가능) — 텍스처는 전역이라 1회만
    if (!this.registry.get('whitened')) {
      const keys: string[] = [];
      for (let i = 0; i < 8; i++) keys.push(`walk_${i}`, `run_${i}`, `run_jump_${i}`);
      for (let i = 0; i < 9; i++) keys.push(`jump_${i}`);
      for (let i = 0; i < 6; i++) keys.push(`punch_${i}`);
      for (let i = 0; i < 3; i++) keys.push(`jab_${i}`);
      keys.forEach((k) => whitenTexture(this, k));
      this.registry.set('whitened', true);
    }

    this.level = loadLevel();
    this.wWidth = worldW(this.level);
    this.wHeight = worldH(this.level);

    // 배경
    this.add.rectangle(this.wWidth / 2, this.wHeight / 2, this.wWidth, this.wHeight, 0xffffff);

    // 솔리드 블록 렌더 (사각형 + 테두리)
    this.renderBlocks();

    // 이동 발판
    this.movingPlatforms = this.level.movers.map((m, i) =>
      new MovingPlatform(
        this, m.c * GRID, m.r * GRID, m.len * GRID, PLAT_VIS_H,
        m.mode, m.range * GRID, m.period, i % 2 ? Math.PI : 0,
      ),
    );

    // 함정
    this.traps = [];
    this.level.traps.forEach((t) => this.drawTrap(t.c, t.r));

    // 정상 깃발 + 도달 판정 영역
    this.drawFlag(this.level.goal.c, this.level.goal.r);

    // 시작점
    const spawnX = this.level.spawn.c * GRID + GRID / 2;
    const spawnY = this.level.spawn.r * GRID;
    this.checkpoint = { x: spawnX, y: spawnY };

    const surfaces = deriveSurfaces(this.level);
    const playerSurfaces = [...surfaces, ...this.movingPlatforms.map((m) => m.surface)];
    this.touchControls = new TouchControls(
      this,
      () => this.player.attackWith('jab'),
      () => this.player.attackWith('cross'),
    );
    this.player = new Player(
      this, spawnX, spawnY, playerSurfaces, this.wWidth, PALETTE[this.colorIndex], this.touchControls,
    );
    this.dummy = new Dummy(this, spawnX + 90, spawnY, surfaces, this.wWidth, this.wHeight);

    // 충돌 파티클
    const g = this.make.graphics({ x: 0, y: 0 });
    g.fillStyle(0xffffff).fillRect(0, 0, 6, 6);
    g.generateTexture('spark', 6, 6);
    g.destroy();
    this.hitParticles = this.add.particles(0, 0, 'spark', {
      speed: { min: 90, max: 240 }, lifespan: 320,
      scale: { start: 1, end: 0 }, angle: { min: 0, max: 360 }, emitting: false,
    });
    this.hitParticles.setDepth(500);

    // 카메라
    this.cameras.main.setBounds(0, 0, this.wWidth, this.wHeight);
    this.camCtl = new CameraController(this, this.player);

    // HUD
    this.add.text(8, 8,
      '← → 이동  Shift 달리기  Space 점프  Z 크로스  X 잽  C 색  E 에디터  M 메뉴',
      { fontSize: '11px', color: '#333333', fontFamily: 'monospace' },
    ).setScrollFactor(0).setDepth(1000);

    // 입력
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Z).on('down', () => this.player.attackWith('cross'));
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.X).on('down', () => this.player.attackWith('jab'));
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.C).on('down', () => {
      this.colorIndex = (this.colorIndex + 1) % PALETTE.length;
      this.player.setColor(PALETTE[this.colorIndex]);
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E).on('down', () => this.scene.start('EditorScene'));
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.M).on('down', () => this.scene.start('MenuScene'));
  }

  /** 솔리드 칸을 사각 블록으로 그림 (한 Graphics에 일괄) */
  private renderBlocks(): void {
    const { cols, rows, solid } = this.level;
    const g = this.add.graphics().setDepth(1);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!solid[r * cols + c]) continue;
        const x = c * GRID, y = r * GRID;
        g.fillStyle(BLOCK_FILL, 1).fillRect(x, y, GRID, GRID);
        g.lineStyle(2, BLOCK_EDGE, 1).strokeRect(x, y, GRID, GRID);
        // 윗면이 노출된 칸엔 밝은 모서리
        if (r === 0 || !solid[(r - 1) * cols + c]) {
          g.fillStyle(0xaeb8c6, 1).fillRect(x, y, GRID, 3);
        }
      }
    }
  }

  /** 칸(c,r)에 정상 깃발을 그리고 도달 판정 영역 등록 */
  private drawFlag(c: number, r: number): void {
    const gx = c * GRID + GRID / 2;
    const baseY = (r + 1) * GRID;
    const topY = baseY - GRID * 1.6;
    const g = this.add.graphics().setDepth(2);
    g.lineStyle(3, 0x555555, 1).lineBetween(gx, baseY, gx, topY);          // 깃대
    g.fillStyle(0xff4444, 1).fillTriangle(gx, topY, gx + 24, topY + 9, gx, topY + 18); // 깃발
    this.goalRect = { x: c * GRID - 6, y: topY, w: GRID + 12, h: baseY - topY };
  }

  /** 칸(c,r)에 가시 함정을 그리고 충돌 영역 등록 */
  private drawTrap(c: number, r: number): void {
    const x = c * GRID, topY = r * GRID, baseY = (r + 1) * GRID;
    const spikeW = 11;
    const g = this.add.graphics().setDepth(3);
    g.fillStyle(0xd83a3a, 1).lineStyle(1.5, 0x7a1010, 1);
    for (let sx = x; sx + spikeW <= x + GRID; sx += spikeW) {
      g.fillTriangle(sx, baseY, sx + spikeW / 2, topY, sx + spikeW, baseY);
      g.strokeTriangle(sx, baseY, sx + spikeW / 2, topY, sx + spikeW, baseY);
    }
    this.traps.push({ x, y: topY, w: GRID, h: GRID });
  }

  update(_time: number, delta: number): void {
    if (this.won) { this.camCtl.update(delta); return; }

    if (this.comboTimer > 0) {
      this.comboTimer -= delta / 1000;
      if (this.comboTimer <= 0) this.comboCount = 0;
    }
    if (this.hitStop > 0) {
      this.hitStop -= delta / 1000;
      this.camCtl.update(delta);
      return;
    }
    this.movingPlatforms.forEach((m) => m.update(delta));
    this.player.update(delta);
    this.dummy.update(delta);
    this.checkPunchHit();
    this.handleHazards();
    this.checkGoal();
    this.camCtl.update(delta);
  }

  /** 깃발에 닿으면 승리 */
  private checkGoal(): void {
    const b = this.player.bounds;
    const g = this.goalRect;
    if (b.x1 < g.x + g.w && b.x2 > g.x && b.y1 < g.y + g.h && b.y2 > g.y) this.win();
  }

  private win(): void {
    this.won = true;
    this.touchControls.setVisible(false);
    this.camCtl.shake(0.25, 6);
    this.hitParticles.setParticleTint(0xffd24a);
    this.hitParticles.explode(40, this.player.x, this.player.focusY);

    const cx = this.scale.width / 2, cy = this.scale.height / 2;
    this.add.rectangle(cx, cy, this.scale.width, this.scale.height, 0x000000, 0.55)
      .setScrollFactor(0).setDepth(2000);
    this.add.text(cx, cy - 40, '🏁 정상 도착!', {
      fontSize: '30px', color: '#ffd24a', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2001);
    this.add.text(cx, cy - 6, '승리!', {
      fontSize: '18px', color: '#ffffff', fontFamily: 'monospace',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2001);
    this.winButton(cx, cy + 36, '↻  다시 하기', () => this.scene.restart());
    this.winButton(cx, cy + 66, '≡  메뉴', () => this.scene.start('MenuScene'));
  }

  private winButton(x: number, y: number, label: string, cb: () => void): void {
    const t = this.add.text(x, y, label, {
      fontSize: '15px', color: '#ffffff', fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(2001).setScrollFactor(0).setInteractive({ useHandCursor: true });
    t.on('pointerover', () => t.setColor('#ffcc00'));
    t.on('pointerout', () => t.setColor('#ffffff'));
    t.on('pointerup', cb);
  }

  private handleHazards(): void {
    const b = this.player.bounds;
    for (const t of this.traps) {
      if (b.x1 < t.x + t.w && b.x2 > t.x && b.y1 < t.y + t.h && b.y2 > t.y) {
        this.respawn();
        return;
      }
    }
    if (this.player.feetY > this.wHeight + 120) { this.respawn(); return; }
    if (this.player.onStableGround) {
      this.checkpoint.x = this.player.x;
      this.checkpoint.y = this.player.feetY;
    }
  }

  private respawn(): void {
    this.hitParticles.setParticleTint(PALETTE[this.colorIndex]);
    this.hitParticles.explode(22, this.player.x, this.player.focusY);
    this.player.respawnAt(this.checkpoint.x, this.checkpoint.y);
    this.camCtl.shake(0.18, 6);
  }

  private checkPunchHit(): void {
    const box = this.player.activeHitbox();
    if (!box || !this.dummy.overlaps(box)) return;

    const dir = this.player.facingDir;
    const knock = this.player.knockInfo!;
    const baseJuice = this.player.attackJuice;
    this.player.markHit();

    this.comboCount++;
    this.comboTimer = COMBO_WINDOW;
    const mult = Math.min(1 + (this.comboCount - 1) * 0.3, 2.2);
    const decisive = this.comboCount >= 4;

    this.dummy.knockback(dir, knock.vx * Math.min(mult, 1.8), knock.vy * Math.min(mult, 1.6));
    this.hitParticles.setParticleTint(this.dummy.color);
    this.hitParticles.explode(Math.round((6 + 9 * baseJuice) * Math.min(mult, 2.2)), this.dummy.x, this.dummy.focusY);

    if (decisive) {
      this.hitStop = Math.min(0.07 + 0.03 * (this.comboCount - 3), 0.2);
      this.camCtl.hitJuice(dir, Math.min(baseJuice * mult, 1.9));
    } else {
      this.hitStop = 0.03 + 0.03 * baseJuice;
      this.camCtl.hitJuice(dir, baseJuice * 0.85);
    }
  }
}
