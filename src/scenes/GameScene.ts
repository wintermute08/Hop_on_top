import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { MovingPlatform } from '../entities/MovingPlatform';
import { CameraController } from '../systems/CameraController';
import { TouchControls } from '../systems/TouchControls';
import { Background } from '../systems/Background';
import { sfx } from '../systems/Sfx';
import { GRID, loadLevel, deriveSurfaces, worldW, worldH, type LevelData } from '../level/LevelData';

interface Trap { x: number; y: number; w: number; h: number; }

const COMBO_WINDOW = 1.2;
const PLAT_VIS_H = GRID;
const BEST_TIME_KEY = 'hop_best_time';
const HURT_KNOCK_VX = 270;
const HURT_KNOCK_VY = -230;
const BLOCK_FILL = '#6f7e93';
const BLOCK_EDGE = '#39424f';
const RUN_DUST_INTERVAL = 0.13;
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
  private enemies: Enemy[] = [];
  private camCtl!: CameraController;
  private touchControls!: TouchControls;
  private hitParticles!: Phaser.GameObjects.Particles.ParticleEmitter;
  private dustParticles!: Phaser.GameObjects.Particles.ParticleEmitter;
  private playerShadow!: Phaser.GameObjects.Image;
  private comboText!: Phaser.GameObjects.Text;
  private statsText!: Phaser.GameObjects.Text;
  private lastStats = '';
  private koCount = 0;
  private elapsed = 0;   // 클리어 타이머(초) — 승리 시 정지
  private runDustTimer = 0;
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

    // 배경 (그라데이션 하늘 + 패럴랙스 구름/능선)
    new Background(this, this.wWidth, this.wHeight);

    // 솔리드 블록 렌더 (텍스처 타일, 노출면에만 테두리)
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
      () => { if (this.player.attackWith('jab')) sfx.swing(); },
      () => { if (this.player.attackWith('cross')) sfx.swing(); },
    );
    // 캐릭터 그림자 (지면과의 높이차로 크기/농도 변화 → 공중감 표현)
    if (!this.textures.exists('shadow')) {
      const sc = document.createElement('canvas');
      sc.width = 48; sc.height = 20;
      const sctx = sc.getContext('2d')!;
      const grad = sctx.createRadialGradient(24, 10, 0, 24, 10, 24);
      grad.addColorStop(0, 'rgba(0,0,0,0.5)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      sctx.fillStyle = grad;
      sctx.fillRect(0, 0, 48, 20);
      this.textures.addCanvas('shadow', sc);
    }

    this.player = new Player(
      this, spawnX, spawnY, playerSurfaces, this.wWidth, PALETTE[this.colorIndex], this.touchControls,
    );
    this.playerShadow = this.add.image(spawnX, spawnY, 'shadow').setDepth(8);

    // 적 배치 (walk 애니메이션은 Player 생성 시 등록됨)
    this.koCount = 0;
    this.elapsed = 0;
    this.enemies = this.level.enemies.map((e) =>
      new Enemy(this, e.c * GRID + GRID / 2, e.r * GRID, e.kind, surfaces, this.wWidth, this.wHeight),
    );

    // 콤보 카운터 HUD
    this.comboText = this.add.text(this.scale.width / 2, 34, '', {
      fontSize: '20px', color: '#ffd24a', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1500).setVisible(false)
      .setStroke('#3c2a0a', 4);

    // 타이머/KO HUD
    this.statsText = this.add.text(8, 24, '', {
      fontSize: '12px', color: '#333333', fontFamily: 'monospace', fontStyle: 'bold',
    }).setScrollFactor(0).setDepth(1000);
    this.lastStats = '';

    // 충돌 파티클
    const g = this.make.graphics({ x: 0, y: 0 });
    g.fillStyle(0xffffff).fillRect(0, 0, 6, 6);
    g.generateTexture('spark', 6, 6);
    g.clear();
    g.fillStyle(0xffffff, 1).fillCircle(4, 4, 4);
    g.generateTexture('dust', 8, 8);
    g.destroy();
    this.hitParticles = this.add.particles(0, 0, 'spark', {
      speed: { min: 90, max: 240 }, lifespan: 320,
      scale: { start: 1, end: 0 }, angle: { min: 0, max: 360 }, emitting: false,
    });
    this.hitParticles.setDepth(500);

    // 먼지 파티클 (착지/달리기) — 옆으로 퍼지며 살짝 떠오르는 부드러운 퍼프
    this.dustParticles = this.add.particles(0, 0, 'dust', {
      speed: { min: 15, max: 60 }, lifespan: { min: 280, max: 450 },
      scale: { start: 0.9, end: 0 }, alpha: { start: 0.7, end: 0 },
      angle: { min: 200, max: 340 }, gravityY: -30,
      tint: 0xcdd6e0, emitting: false,
    });
    this.dustParticles.setDepth(400);

    // 플레이어 모션 이벤트 → 먼지 + 사운드
    this.events.on('player-land', this.onPlayerLand, this);
    this.events.on('player-jump', this.onPlayerJump, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off('player-land', this.onPlayerLand, this);
      this.events.off('player-jump', this.onPlayerJump, this);
    });

    // 사운드 unlock(브라우저 정책상 첫 입력 필요) — 이후 BGM 자동 시작
    this.input.once('pointerdown', () => sfx.unlock());
    this.input.keyboard!.once('keydown', () => sfx.unlock());

    // 카메라
    this.cameras.main.setBounds(0, 0, this.wWidth, this.wHeight);
    this.camCtl = new CameraController(this, this.player);

    // 은은한 비네트 (WebGL에서만)
    try {
      this.cameras.main.postFX?.addVignette(0.5, 0.5, 0.95, 0.3);
    } catch { /* Canvas 렌더러 등 미지원 환경 무시 */ }

    // HUD
    this.add.text(8, 8,
      '← → 이동  Shift 달리기  Space 점프  Z 크로스  X 잽  C 색  E 에디터  M 메뉴',
      { fontSize: '11px', color: '#333333', fontFamily: 'monospace' },
    ).setScrollFactor(0).setDepth(1000);

    // 음소거 토글 (설정은 localStorage에 유지)
    const muteBtn = this.add.text(this.scale.width - 10, 6, sfx.muted ? '🔇' : '🔊', {
      fontSize: '16px',
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(2000).setInteractive({ useHandCursor: true });
    muteBtn.on('pointerdown', () => {
      sfx.unlock();
      muteBtn.setText(sfx.toggleMute() ? '🔇' : '🔊');
    });

    // 입력
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Z).on('down', () => {
      if (this.player.attackWith('cross')) sfx.swing();
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.X).on('down', () => {
      if (this.player.attackWith('jab')) sfx.swing();
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.C).on('down', () => {
      this.colorIndex = (this.colorIndex + 1) % PALETTE.length;
      this.player.setColor(PALETTE[this.colorIndex]);
    });
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E).on('down', () => this.scene.start('EditorScene'));
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.M).on('down', () => this.scene.start('MenuScene'));

    this.showReadyGo();
  }

  /** 시작 연출: READY → GO! (조작은 막지 않음) */
  private showReadyGo(): void {
    const cx = this.scale.width / 2, cy = this.scale.height / 2 - 30;
    const ready = this.add.text(cx, cy, 'READY', {
      fontSize: '30px', color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1800).setStroke('#1a1a2e', 6).setScale(0.3);
    this.tweens.add({
      targets: ready, scale: 1, duration: 220, ease: 'Back.Out',
      onComplete: () => this.tweens.add({
        targets: ready, alpha: 0, delay: 420, duration: 140,
        onComplete: () => {
          ready.destroy();
          const go = this.add.text(cx, cy, 'GO!', {
            fontSize: '40px', color: '#ffd24a', fontFamily: 'monospace', fontStyle: 'bold',
          }).setOrigin(0.5).setScrollFactor(0).setDepth(1800).setStroke('#3c2a0a', 7).setScale(0.3);
          this.tweens.add({
            targets: go, scale: 1, duration: 200, ease: 'Back.Out',
            onComplete: () => this.tweens.add({
              targets: go, alpha: 0, y: cy - 24, delay: 320, duration: 220,
              onComplete: () => go.destroy(),
            }),
          });
        },
      }),
    });
  }

  /**
   * 솔리드 칸을 하나의 캔버스 레이어로 렌더.
   * 셀마다 노이즈 스페클을 얹고, 이웃이 비어 '노출된' 면에만 라이팅(위=밝게,
   * 아래=그림자)과 외곽선을 그려 붙은 블록이 한 덩어리 지형으로 보이게 한다.
   */
  private renderBlocks(): void {
    const { cols, rows, solid } = this.level;
    const at = (c: number, r: number) =>
      c >= 0 && c < cols && r >= 0 && r < rows && solid[r * cols + c];

    const canvas = document.createElement('canvas');
    canvas.width = this.wWidth;
    canvas.height = this.wHeight;
    const ctx = canvas.getContext('2d')!;

    let seed = 3;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!solid[r * cols + c]) continue;
        const x = c * GRID, y = r * GRID;

        ctx.fillStyle = BLOCK_FILL;
        ctx.fillRect(x, y, GRID, GRID);

        // 돌 질감 스페클
        for (let i = 0; i < 9; i++) {
          ctx.fillStyle = rand() < 0.5 ? 'rgba(58,68,88,0.20)' : 'rgba(216,226,240,0.14)';
          const sw = rand() < 0.3 ? 3 : 2;
          ctx.fillRect(x + 2 + Math.floor(rand() * (GRID - 6)), y + 2 + Math.floor(rand() * (GRID - 6)), sw, 2);
        }

        // 노출면 라이팅
        if (!at(c, r - 1)) {
          ctx.fillStyle = '#aeb8c6';
          ctx.fillRect(x, y, GRID, 4);
        }
        if (!at(c, r + 1)) {
          ctx.fillStyle = 'rgba(40,48,64,0.45)';
          ctx.fillRect(x, y + GRID - 3, GRID, 3);
        }
        if (!at(c - 1, r)) {
          ctx.fillStyle = 'rgba(255,255,255,0.10)';
          ctx.fillRect(x, y, 2, GRID);
        }
        if (!at(c + 1, r)) {
          ctx.fillStyle = 'rgba(40,48,64,0.30)';
          ctx.fillRect(x + GRID - 2, y, 2, GRID);
        }

        // 노출면에만 외곽선 → 그리드가 아니라 지형 덩어리로 보임
        ctx.fillStyle = BLOCK_EDGE;
        if (!at(c, r - 1)) ctx.fillRect(x, y, GRID, 2);
        if (!at(c, r + 1)) ctx.fillRect(x, y + GRID - 2, GRID, 2);
        if (!at(c - 1, r)) ctx.fillRect(x, y, 2, GRID);
        if (!at(c + 1, r)) ctx.fillRect(x + GRID - 2, y, 2, GRID);
      }
    }

    if (this.textures.exists('blocks_layer')) this.textures.remove('blocks_layer');
    this.textures.addCanvas('blocks_layer', canvas);
    this.add.image(0, 0, 'blocks_layer').setOrigin(0).setDepth(1);
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
    this.updateShadow(this.playerShadow, this.player.x, this.player.feetY, this.player.groundYBelow());

    if (this.won) { this.camCtl.update(delta); return; }

    this.elapsed += delta / 1000;
    this.updateStatsHud();

    if (this.comboTimer > 0) {
      this.comboTimer -= delta / 1000;
      if (this.comboTimer <= 0) { this.comboCount = 0; this.comboText.setVisible(false); }
    }
    if (this.hitStop > 0) {
      this.hitStop -= delta / 1000;
      this.camCtl.update(delta);
      return;
    }
    this.movingPlatforms.forEach((m) => m.update(delta));
    this.player.update(delta);
    this.enemies.forEach((e) => e.update(delta, this.player.x, this.player.feetY));
    this.updateRunDust(delta / 1000);
    this.checkPunchHit();
    this.checkEnemyContact();
    this.consumeDeadEnemies();
    this.handleHazards();
    this.checkGoal();
    this.camCtl.update(delta);
  }

  private updateStatsHud(): void {
    const s = `⏱ ${formatTime(this.elapsed)}  ·  KO ${this.koCount}`;
    if (s !== this.lastStats) {
      this.lastStats = s;
      this.statsText.setText(s);
    }
  }

  /** 적 몸통에 닿으면 넉백 + 무적 (넉백 비행 중인 적은 무해) */
  private checkEnemyContact(): void {
    if (this.player.isInvulnerable) return;
    const pb = this.player.bounds;
    for (const e of this.enemies) {
      if (!e.harmful || !e.overlaps(pb)) continue;
      const dir = this.player.x >= e.x ? 1 : -1;
      this.player.applyKnockback(dir * HURT_KNOCK_VX, HURT_KNOCK_VY);
      this.comboCount = 0;
      this.comboText.setVisible(false);
      this.popupText(this.player.x, this.player.focusY - 20, '!', '#ff5a5a');
      this.hitParticles.setParticleTint(PALETTE[this.colorIndex]);
      this.hitParticles.explode(10, this.player.x, this.player.focusY);
      sfx.hit(0.4);
      this.camCtl.shake(0.12, 5);
      return;
    }
  }

  /** 함정에 닿거나 장외로 나간 적 처리 → KO 카운트 + 연출 */
  private consumeDeadEnemies(): void {
    for (const e of this.enemies) {
      if (e.dead) continue;
      const b = e.bounds;
      for (const t of this.traps) {
        if (b.x1 < t.x + t.w && b.x2 > t.x && b.y1 < t.y + t.h && b.y2 > t.y) {
          e.dead = true;
          break;
        }
      }
    }
    const dead = this.enemies.filter((e) => e.dead);
    if (dead.length === 0) return;
    for (const e of dead) {
      this.koCount++;
      this.popupText(
        Phaser.Math.Clamp(e.x, 20, this.wWidth - 20),
        Math.min(e.feetY, this.wHeight - 40) - 30,
        'KO!', '#ffd24a',
      );
      this.hitParticles.setParticleTint(e.color);
      this.hitParticles.explode(18, e.x, e.focusY);
      sfx.hit(0.9);
      e.destroy();
    }
    this.enemies = this.enemies.filter((e) => !e.dead);
  }

  /** 지상에서 빠르게 달릴 때 발밑 먼지를 주기적으로 흩뿌림 */
  private updateRunDust(dt: number): void {
    if (this.player.grounded && Math.abs(this.player.velX) > 100) {
      this.runDustTimer -= dt;
      if (this.runDustTimer <= 0) {
        this.runDustTimer = RUN_DUST_INTERVAL;
        this.dustParticles.explode(2, this.player.x - this.player.facingDir * 10, this.player.feetY - 2);
      }
    } else {
      this.runDustTimer = 0;
    }
  }

  /** 그림자 위치/크기/농도를 지면과의 높이차에 맞춰 갱신 (없으면 숨김) */
  private updateShadow(img: Phaser.GameObjects.Image, x: number, feetY: number, groundY: number | null): void {
    if (groundY === null) { img.setVisible(false); return; }
    const gap = Math.max(0, groundY - feetY);
    const scale = Phaser.Math.Clamp(1 - gap / 140, 0.3, 1);
    const alpha = Phaser.Math.Clamp(0.5 - gap / 200, 0, 0.5);
    img.setVisible(alpha > 0.02).setPosition(x, groundY - 2).setScale(scale);
    if (alpha > 0.02) img.setAlpha(alpha);
  }

  /** 타격 시 떠오르며 사라지는 팝업 텍스트 */
  private popupText(x: number, y: number, text: string, color: string): void {
    const t = this.add.text(x, y, text, {
      fontSize: '14px', color, fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(600).setStroke('#000000', 3);
    this.tweens.add({
      targets: t, y: y - 34, alpha: 0, duration: 550, ease: 'Cubic.Out',
      onComplete: () => t.destroy(),
    });
  }

  private onPlayerLand(x: number, y: number): void {
    this.dustParticles.explode(8, x, y - 2);
    sfx.land();
  }

  private onPlayerJump(): void {
    this.dustParticles.explode(5, this.player.x, this.player.feetY - 2);
    sfx.jump();
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
    this.statsText.setVisible(false);
    this.comboText.setVisible(false);
    sfx.win();
    this.camCtl.shake(0.25, 6);
    this.hitParticles.setParticleTint(0xffd24a);
    this.hitParticles.explode(40, this.player.x, this.player.focusY);

    // 최고 기록 (localStorage 영속)
    let best = Number.POSITIVE_INFINITY;
    try { best = Number(localStorage.getItem(BEST_TIME_KEY)) || Number.POSITIVE_INFINITY; } catch { /* 무시 */ }
    const isRecord = this.elapsed < best;
    if (isRecord) {
      try { localStorage.setItem(BEST_TIME_KEY, String(this.elapsed)); } catch { /* 무시 */ }
    }
    const bestShown = Math.min(best, this.elapsed);

    const cx = this.scale.width / 2, cy = this.scale.height / 2;
    this.add.rectangle(cx, cy, this.scale.width, this.scale.height, 0x000000, 0.55)
      .setScrollFactor(0).setDepth(2000);

    const title = this.add.text(cx, cy - 64, '🏁 정상 도착!', {
      fontSize: '30px', color: '#ffd24a', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2001).setScale(0.2);
    this.tweens.add({ targets: title, scale: 1, duration: 350, ease: 'Back.Out' });

    this.add.text(cx, cy - 30,
      `⏱ ${formatTime(this.elapsed)}   ·   KO ${this.koCount}`, {
      fontSize: '16px', color: '#ffffff', fontFamily: 'monospace',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2001);

    this.add.text(cx, cy - 8,
      isRecord ? '✨ 신기록!' : `최고 기록 ${formatTime(bestShown)}`, {
      fontSize: '13px', color: isRecord ? '#7bffb0' : '#a0b8d0', fontFamily: 'monospace',
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
    sfx.respawn();
  }

  private checkPunchHit(): void {
    const box = this.player.activeHitbox();
    if (!box) return;
    const target = this.enemies.find((e) => !e.dead && e.overlaps(box));
    if (!target) return;

    const dir = this.player.facingDir;
    const knock = this.player.knockInfo!;
    const baseJuice = this.player.attackJuice;
    this.player.markHit();

    this.comboCount++;
    this.comboTimer = COMBO_WINDOW;
    const mult = Math.min(1 + (this.comboCount - 1) * 0.3, 2.2);
    const decisive = this.comboCount >= 4;

    sfx.hit(Math.min(baseJuice * mult, 1.5) / 1.5);
    target.knockback(dir, knock.vx * Math.min(mult, 1.8), knock.vy * Math.min(mult, 1.6));
    this.hitParticles.setParticleTint(target.color);
    this.hitParticles.explode(Math.round((6 + 9 * baseJuice) * Math.min(mult, 2.2)), target.x, target.focusY);

    const label = decisive ? 'CRUSH!' : this.comboCount >= 2 ? `HIT x${this.comboCount}` : 'HIT';
    this.popupText(target.x, target.focusY - 24, label, decisive ? '#ff5a5a' : '#ffffff');

    if (this.comboCount >= 2) {
      this.comboText.setText(`${this.comboCount} COMBO!`).setVisible(true).setScale(1.4).setAlpha(1);
      this.tweens.add({ targets: this.comboText, scale: 1, duration: 180, ease: 'Back.Out' });
    }

    if (decisive) {
      this.hitStop = Math.min(0.07 + 0.03 * (this.comboCount - 3), 0.2);
      this.camCtl.hitJuice(dir, Math.min(baseJuice * mult, 1.9));
    } else {
      this.hitStop = 0.03 + 0.03 * baseJuice;
      this.camCtl.hitJuice(dir, baseJuice * 0.85);
    }
  }
}

/** 초 → M:SS.d 표기 */
function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}
