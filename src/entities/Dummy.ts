import type { Platform, Hitbox } from './Player';

const FOOT_RATIO    = 82 / 92;
const BODY_OFFSET   = 35;
const GRAVITY       = 1000;
const HALF_W        = 18;
const HALF_H        = 33;

/** 펀치 타격감 확인용 연습 더미. 맞으면 넉백되어 날아가고, 떨어지면 리스폰. */
export class Dummy {
  private sprite: Phaser.GameObjects.Sprite;
  private vx = 0;
  private vy = 0;
  private onGround = true;
  private platforms: Platform[];
  private worldW: number;
  private worldH: number;
  private spawnX: number;
  private spawnY: number;
  readonly color = 0xe08585; // 연한 코랄레드

  constructor(scene: Phaser.Scene, x: number, feetY: number, platforms: Platform[], worldW: number, worldH: number) {
    this.platforms = platforms;
    this.worldW = worldW;
    this.worldH = worldH;
    this.spawnX = x;
    this.spawnY = feetY;
    this.sprite = scene.add.sprite(x, feetY, 'walk_0');
    this.sprite.setOrigin(0.5, FOOT_RATIO);
    this.sprite.setTint(this.color);
  }

  knockback(dir: number, vx: number, vy: number): void {
    this.vx = dir * vx;
    this.vy = vy;
    this.onGround = false;
  }

  update(delta: number): void {
    const dt = delta / 1000;

    if (!this.onGround) this.vy += GRAVITY * dt;

    // 넉백 후 수평 감속
    this.vx *= Math.pow(0.02, dt);

    this.sprite.x = Phaser.Math.Clamp(this.sprite.x + this.vx * dt, -200, this.worldW + 200);

    const oldY = this.sprite.y;
    let newY = oldY + this.vy * dt;
    if (this.vy >= 0) {
      const top = this.landingTop(this.sprite.x, oldY, newY);
      if (top !== null) { newY = top; this.vy = 0; this.onGround = true; }
      else this.onGround = false;
    } else {
      this.onGround = false;
    }
    this.sprite.y = newY;

    // 떨어지거나 화면 밖으로 날아가면 리스폰
    if (this.sprite.y > this.worldH + 150 || this.sprite.x < -150 || this.sprite.x > this.worldW + 150) {
      this.respawn();
    }
  }

  private landingTop(x: number, oldY: number, newY: number): number | null {
    let best: number | null = null;
    for (const p of this.platforms) {
      if (x < p.x || x > p.x + p.w) continue;
      if (oldY <= p.y && newY >= p.y) {
        if (best === null || p.y < best) best = p.y;
      }
    }
    return best;
  }

  private respawn(): void {
    this.sprite.setPosition(this.spawnX, this.spawnY);
    this.vx = 0; this.vy = 0; this.onGround = true;
  }

  /** 펀치 히트박스와의 겹침 판정 */
  overlaps(box: Hitbox): boolean {
    const cx = this.sprite.x;
    const cy = this.sprite.y - BODY_OFFSET;
    return box.x1 < cx + HALF_W && box.x2 > cx - HALF_W &&
           box.y1 < cy + HALF_H && box.y2 > cy - HALF_H;
  }

  get x(): number { return this.sprite.x; }
  get focusY(): number { return this.sprite.y - BODY_OFFSET; }
}
