import Phaser from 'phaser';
import type { Platform, Hitbox } from './Player';
import type { EnemyKind } from '../level/LevelData';

const FOOT_RATIO  = 82 / 92;
const BODY_OFFSET = 35;
const GRAVITY     = 1000;
const HALF_W      = 16;
const HALF_H      = 32;
const EDGE_MARGIN = 8;    // 발판 가장자리에서 이만큼 안쪽에서 방향 전환

const PATROL_SPEED = 42;

const CHARGE_SPEED   = 250;
const AGGRO_X        = 210;  // 돌진 발동 수평 거리
const AGGRO_Y        = 46;   // 같은 높이로 간주할 수직 오차
const TELEGRAPH_TIME = 0.45; // 예비동작(점멸) 시간
const DASH_TIMEOUT   = 1.3;
const REST_TIME      = 0.9;

const COLOR: Record<EnemyKind, number> = {
  patrol:  0xb08ae0, // 보라 — 차분한 순찰자
  charger: 0xe06060, // 빨강 — 공격적인 돌진자
};

type AiState = 'idle' | 'patrol' | 'telegraph' | 'dash' | 'rest';

/**
 * PvE 적. 체력 없음 — 위치 싸움.
 * - patrol: 자기 발판 위를 왕복. 몸에 닿으면 플레이어 넉백.
 * - charger: 같은 높이의 플레이어를 발견하면 점멸 예비동작 후 돌진.
 * 펀치 넉백으로 날릴 수 있고, 함정에 닿거나 장외로 나가면 KO.
 */
export class Enemy {
  private sprite: Phaser.GameObjects.Sprite;
  private shadow: Phaser.GameObjects.Image;
  private vx = 0;
  private vy = 0;
  private onGround = false;
  private ground: Platform | null = null;
  private knocked = false;  // 펀치 맞고 날아가는 중 (AI 정지)
  private state: AiState;
  private stateT = 0;
  private dir = 1;
  private platforms: Platform[];
  private worldW: number;
  private worldH: number;
  readonly kind: EnemyKind;
  readonly color: number;
  dead = false;

  constructor(
    scene: Phaser.Scene, x: number, feetY: number, kind: EnemyKind,
    platforms: Platform[], worldW: number, worldH: number,
  ) {
    this.kind = kind;
    this.color = COLOR[kind];
    this.platforms = platforms;
    this.worldW = worldW;
    this.worldH = worldH;
    this.state = kind === 'patrol' ? 'patrol' : 'idle';
    this.dir = Math.random() < 0.5 ? -1 : 1;

    this.sprite = scene.add.sprite(x, feetY, 'walk_0')
      .setOrigin(0.5, FOOT_RATIO).setTint(this.color).setDepth(9);
    this.sprite.play('walk');
    this.shadow = scene.add.image(x, feetY, 'shadow').setDepth(8);
  }

  /** 펀치 등 외부 충격 — AI를 끊고 날려보낸다 */
  knockback(dir: number, vx: number, vy: number): void {
    this.vx = dir * vx;
    this.vy = vy;
    this.onGround = false;
    this.knocked = true;
    this.state = this.kind === 'patrol' ? 'patrol' : 'rest';
    this.stateT = REST_TIME;
    this.sprite.setTint(this.color);
  }

  update(delta: number, playerX: number, playerFeetY: number): void {
    if (this.dead) return;
    const dt = delta / 1000;

    if (!this.knocked && this.onGround) this.updateAi(dt, playerX, playerFeetY);

    if (!this.onGround) this.vy += GRAVITY * dt;
    if (this.knocked) this.vx *= Math.pow(0.02, dt); // 넉백 수평 감속

    this.sprite.x = Phaser.Math.Clamp(this.sprite.x + this.vx * dt, -200, this.worldW + 200);

    // 수직 이동 + one-way 착지 (넉백 상승 중엔 통과)
    const oldY = this.sprite.y;
    let newY = oldY + this.vy * dt;
    if (this.vy >= 0) {
      const surf = this.landingSurface(this.sprite.x, oldY, newY);
      if (surf !== null) {
        newY = surf.y;
        this.vy = 0;
        this.onGround = true;
        this.ground = surf;
        this.knocked = false;
      } else {
        this.onGround = false;
        this.ground = null;
      }
    } else {
      this.onGround = false;
      this.ground = null;
    }
    this.sprite.y = newY;

    // 애니메이션 방향/속도
    this.sprite.setFlipX(this.dir < 0);
    const moving = Math.abs(this.vx) > 1;
    if (moving && this.sprite.anims.currentAnim?.key !== 'walk') this.sprite.play('walk');
    this.sprite.anims.timeScale = this.state === 'dash' ? 2.2 : 1;

    // 장외 → KO (죽음 판정은 씬에서 소비)
    if (this.sprite.y > this.worldH + 150 || this.sprite.x < -60 || this.sprite.x > this.worldW + 60) {
      this.dead = true;
    }

    this.updateShadow();
  }

  private updateAi(dt: number, playerX: number, playerFeetY: number): void {
    switch (this.state) {
      case 'patrol': {
        this.vx = this.dir * PATROL_SPEED;
        const g = this.ground!;
        if (this.sprite.x <= g.x + EDGE_MARGIN) this.dir = 1;
        else if (this.sprite.x >= g.x + g.w - EDGE_MARGIN) this.dir = -1;
        break;
      }
      case 'idle': {
        this.vx = 0;
        const dx = playerX - this.sprite.x;
        if (Math.abs(dx) < AGGRO_X && Math.abs(playerFeetY - this.sprite.y) < AGGRO_Y) {
          this.dir = dx >= 0 ? 1 : -1;
          this.state = 'telegraph';
          this.stateT = TELEGRAPH_TIME;
        }
        break;
      }
      case 'telegraph': {
        this.vx = 0;
        this.stateT -= dt;
        // 예비동작: 빠르게 흰색/본색 점멸 — "곧 돌진한다"는 신호
        this.sprite.setTint(Math.floor(this.stateT * 14) % 2 ? 0xffffff : this.color);
        if (this.stateT <= 0) {
          this.sprite.setTint(this.color);
          this.state = 'dash';
          this.stateT = DASH_TIMEOUT;
        }
        break;
      }
      case 'dash': {
        this.vx = this.dir * CHARGE_SPEED;
        this.stateT -= dt;
        const g = this.ground!;
        const nextX = this.sprite.x + this.vx * (1 / 60);
        // 발판 끝에서는 멈춤 — 스스로 떨어져 죽지 않는다
        if (nextX <= g.x + EDGE_MARGIN || nextX >= g.x + g.w - EDGE_MARGIN || this.stateT <= 0) {
          this.state = 'rest';
          this.stateT = REST_TIME;
        }
        break;
      }
      case 'rest': {
        this.vx = 0;
        this.stateT -= dt;
        if (this.stateT <= 0) this.state = this.kind === 'patrol' ? 'patrol' : 'idle';
        break;
      }
    }
  }

  private landingSurface(x: number, oldY: number, newY: number): Platform | null {
    let best: Platform | null = null;
    for (const p of this.platforms) {
      if (x < p.x || x > p.x + p.w) continue;
      if (oldY <= p.y && newY >= p.y) {
        if (best === null || p.y < best.y) best = p;
      }
    }
    return best;
  }

  private updateShadow(): void {
    let groundY: number | null = null;
    const x = this.sprite.x, y = this.sprite.y;
    for (const p of this.platforms) {
      if (x < p.x || x > p.x + p.w) continue;
      if (p.y >= y - 1 && (groundY === null || p.y < groundY)) groundY = p.y;
    }
    if (groundY === null) { this.shadow.setVisible(false); return; }
    const gap = Math.max(0, groundY - y);
    const scale = Phaser.Math.Clamp(1 - gap / 140, 0.3, 1);
    const alpha = Phaser.Math.Clamp(0.5 - gap / 200, 0, 0.5);
    this.shadow.setVisible(alpha > 0.02).setPosition(x, groundY - 2).setScale(scale).setAlpha(alpha);
  }

  /** 플레이어/펀치와의 AABB 판정용 몸통 박스 */
  get bounds(): Hitbox {
    const cx = this.sprite.x, cy = this.sprite.y - BODY_OFFSET;
    return { x1: cx - HALF_W, x2: cx + HALF_W, y1: cy - HALF_H, y2: cy + HALF_H };
  }

  overlaps(box: Hitbox): boolean {
    const b = this.bounds;
    return box.x1 < b.x2 && box.x2 > b.x1 && box.y1 < b.y2 && box.y2 > b.y1;
  }

  /** 넉백 비행 중엔 몸통 판정 없음 (이미 맞은 적에게 연속 피격당하지 않게) */
  get harmful(): boolean { return !this.dead && !this.knocked; }

  get x(): number { return this.sprite.x; }
  get feetY(): number { return this.sprite.y; }
  get focusY(): number { return this.sprite.y - BODY_OFFSET; }

  destroy(): void {
    this.sprite.destroy();
    this.shadow.destroy();
  }
}
