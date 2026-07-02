import type { TouchInput } from '../systems/TouchControls';

type GroundState = 'idle' | 'walk' | 'run';
type AirAnim = 'jump' | 'run_jump';
type State = GroundState | AirAnim | 'crouch' | 'attack';

export type AttackType = 'cross' | 'jab';
export interface Hitbox { x1: number; x2: number; y1: number; y2: number; }
export interface KnockInfo { vx: number; vy: number; }

/**
 * one-way 발판: top(y) 높이의 [x, x+w] 구간. 아래에서 위로는 통과, 위에서 착지.
 * dx/dy = 이번 프레임 이동량(움직이는 발판). 그 위에 선 캐릭터를 함께 실어 나른다.
 */
export interface Platform {
  x: number;
  y: number;
  w: number;
  dx?: number;
  dy?: number;
}

const SPRITE_H   = 92;
// 스프라이트 실제 발 위치(82행) 기준 origin — 아래 투명 여백 10px만큼 떠 보이던 문제 보정
const FOOT_RATIO = 82 / SPRITE_H;
// 발(origin)에서 캐릭터 몸통 중앙까지의 거리(카메라 포커스용). 보이는 영역 13~81행의 중심 ≈ 35px 위
const BODY_CENTER_OFFSET = 35;
const WALK_SPEED = 80;   // px/s
const RUN_SPEED  = 180;  // px/s
const ACCEL      = 600;  // px/s²

const JUMP_ANTICIPATION = 0.11; // 도약 전 바닥에서 웅크리는 시간(초)
const JUMP_VY      = -430;  // 도약 순간 속도(클수록 땅을 강하게 차고 나감)
const RISE_GRAVITY = 1300;  // 상승 중 중력 — 빠르게 정점에 도달해 추진감
const FALL_GRAVITY = 850;   // 하강 중 중력 — 낮춰서 낙하를 덜 급하게

const PEAK_HEIGHT  = (JUMP_VY * JUMP_VY) / (2 * RISE_GRAVITY);
const LAND_VY      = Math.sqrt(2 * FALL_GRAVITY * PEAK_HEIGHT);

/** 공격 정의. cross=묵직/느림, jab=빠름/가벼움 */
interface AttackDef {
  texKey: string;      // 텍스처 접두사
  frames: number;
  frameStep: number;   // 프레임당 시간
  duration: number;    // 모션 + 마지막 자세 유지 포함 전체 시간
  activeStart: number; // 히트박스 활성 구간(뻗는 시점)
  activeEnd: number;
  reach: number;       // 정면 사거리(중심 기준)
  halfH: number;       // 히트박스 세로 반높이
  moveCap: number;     // 공격 중 허용 이동 속도
  originY: number[];   // 프레임별 발 위치 보정(투명 여백 차이 보정)
  knockVx: number;     // 넉백 수평
  knockVy: number;     // 넉백 띄움
  juice: number;       // 타격 연출 강도(0~1)
}

const ATTACKS: Record<AttackType, AttackDef> = {
  // 크로스 펀치 — 강하고 느림
  cross: {
    texKey: 'punch', frames: 6, frameStep: 0.06, duration: 0.5,
    activeStart: 0.22, activeEnd: 0.42, reach: 54, halfH: 30, moveCap: 55,
    originY: [79, 79, 79, 78, 77, 80].map(v => v / SPRITE_H),
    knockVx: 470, knockVy: -360, juice: 1,
  },
  // 레프트 잽 — 빠르고 가벼움
  jab: {
    texKey: 'jab', frames: 3, frameStep: 0.05, duration: 0.2,
    activeStart: 0.05, activeEnd: 0.11, reach: 48, halfH: 28, moveCap: 75,
    originY: [80, 80, 79].map(v => v / SPRITE_H),
    knockVx: 260, knockVy: -195, juice: 0.55,
  },
};

const GROUND_ANIM: Record<'walk' | 'run', { frames: number; fps: number }> = {
  walk: { frames: 8, fps: 8 },
  run:  { frames: 8, fps: 12 },
};
const AIR_FRAMES: Record<AirAnim, number> = { jump: 9, run_jump: 8 };

function approach(current: number, target: number, step: number): number {
  if (current < target) return Math.min(current + step, target);
  if (current > target) return Math.max(current - step, target);
  return target;
}

// 외곽선: 같은 색을 어둡게 만들어 8방향으로 살짝 깔아 테두리를 만든다
const OUTLINE_DARKEN = 0.5;
const O = 2;
const OUTLINE_OFFSETS: readonly [number, number][] = [
  [-O, 0], [O, 0], [0, -O], [0, O], [-O, -O], [O, -O], [-O, O], [O, O],
];
function darken(c: number, f: number): number {
  const r = Math.round(((c >> 16) & 255) * f);
  const g = Math.round(((c >> 8) & 255) * f);
  const b = Math.round((c & 255) * f);
  return (r << 16) | (g << 8) | b;
}

export class Player {
  private sprite: Phaser.GameObjects.Sprite;
  private outline: Phaser.GameObjects.Sprite[] = [];
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  private shiftKey: Phaser.Input.Keyboard.Key;

  private vx = 0;
  private vy = 0;
  private onGround = true;
  private justLanded = false;
  private ground: Platform | null = null; // 현재 올라선 발판(움직이는 발판 추적용)

  private state: State = 'idle';
  private airAnim: AirAnim | null = null;
  private pendingJump: AirAnim | null = null; // 윈드업 중 예약된 점프 종류
  private crouchTimer = 0;                     // 남은 윈드업 시간(초)
  private attack: AttackDef | null = null;      // 진행 중인 공격 정의
  private attackTimer = 0;                       // 남은 공격 모션 시간(초)
  private attackHasHit = false;                  // 이번 공격으로 이미 명중했는지

  private platforms: Platform[];
  private worldW: number;
  private touch: TouchInput | null;

  constructor(
    scene: Phaser.Scene, x: number, feetY: number, platforms: Platform[], worldW: number, color: number,
    touch: TouchInput | null = null,
  ) {
    this.platforms = platforms;
    this.worldW = worldW;
    this.touch = touch;
    // 외곽선(메인 뒤) → 메인 순서로 생성, depth로 뒤에 배치
    const dark = darken(color, OUTLINE_DARKEN);
    for (let i = 0; i < OUTLINE_OFFSETS.length; i++) {
      this.outline.push(
        scene.add.sprite(x, feetY, 'walk_0').setOrigin(0.5, FOOT_RATIO).setTint(dark).setDepth(9),
      );
    }
    this.sprite = scene.add.sprite(x, feetY, 'walk_0');
    this.sprite.setOrigin(0.5, FOOT_RATIO);
    this.sprite.setTint(color);
    this.sprite.setDepth(10);

    for (const [name, cfg] of Object.entries(GROUND_ANIM) as ['walk' | 'run', typeof GROUND_ANIM['walk']][]) {
      scene.anims.create({
        key: name,
        frames: Array.from({ length: cfg.frames }, (_, i) => ({ key: `${name}_${i}` })),
        frameRate: cfg.fps,
        repeat: -1,
      });
    }

    this.cursors  = scene.input.keyboard!.createCursorKeys();
    this.shiftKey = scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
  }

  update(delta: number): void {
    const dt      = delta / 1000;
    const goRight = this.cursors.right.isDown || (this.touch?.right ?? false);
    const goLeft  = this.cursors.left.isDown || (this.touch?.left ?? false);
    const running = this.shiftKey.isDown || (this.touch?.running ?? false);
    const maxSpd  = running ? RUN_SPEED : WALK_SPEED;

    if (this.attackTimer > 0) this.attackTimer -= dt;

    // 움직이는 발판에 실려 이동 (직전 프레임에 올라타 있었다면)
    if (this.onGround && this.ground) {
      this.sprite.x += this.ground.dx ?? 0;
      this.sprite.y += this.ground.dy ?? 0;
    }

    // 수평 이동 — 공격 중엔 모멘텀 유지하며 부드럽게 감속(방향 고정, 저속 조향만 허용)
    const dir = goRight && !goLeft ? 1 : goLeft && !goRight ? -1 : 0;
    if (this.attackTimer > 0 && this.attack) {
      const target = dir !== 0 ? dir * this.attack.moveCap : 0;
      this.vx = approach(this.vx, target, ACCEL * dt);
    } else if (dir !== 0) {
      this.vx = approach(this.vx, dir * maxSpd, ACCEL * dt);
      this.sprite.setFlipX(dir < 0);
    } else {
      this.vx = 0;
    }

    // 점프 입력 → 윈드업 예약 (점프 종류는 입력 순간에 결정, 펀치 중엔 불가)
    const jumpPressed = Phaser.Input.Keyboard.JustDown(this.cursors.space) || (this.touch?.consumeJump() ?? false);
    if (jumpPressed && this.onGround && this.pendingJump === null && this.attackTimer <= 0) {
      this.pendingJump = running && Math.abs(this.vx) > 1 ? 'run_jump' : 'jump';
      this.crouchTimer = JUMP_ANTICIPATION;
    }

    // 윈드업: 바닥에서 잠깐 웅크렸다가 시간이 지나면 도약
    if (this.pendingJump !== null && this.onGround) {
      this.crouchTimer -= dt;
      if (this.crouchTimer <= 0) {
        this.vy = JUMP_VY;
        this.onGround = false;
        this.airAnim = this.pendingJump;
        this.pendingJump = null;
      }
    }

    // 중력
    if (!this.onGround) {
      this.vy += (this.vy < 0 ? RISE_GRAVITY : FALL_GRAVITY) * dt;
    }

    // 수평 적용
    this.sprite.x = Phaser.Math.Clamp(this.sprite.x + this.vx * dt, 0, this.worldW);

    // 수직 적용 + one-way 발판 충돌
    const oldY = this.sprite.y;
    let newY = oldY + this.vy * dt;
    if (this.vy >= 0) {
      const surf = this.landingSurface(this.sprite.x, oldY, newY);
      if (surf !== null) {
        newY = surf.y;
        this.vy = 0;
        if (!this.onGround) this.justLanded = true;
        this.onGround = true;
        this.ground = surf;
      } else {
        this.onGround = false;
        this.ground = null;
      }
    } else {
      this.onGround = false;
      this.ground = null;
    }
    this.sprite.y = newY;

    this.updateState(running);
    this.syncOutline();
  }

  /** 외곽선 스프라이트를 메인과 동일 프레임/방향/위치로 동기화 */
  private syncOutline(): void {
    const key = this.sprite.texture.key;
    for (let i = 0; i < this.outline.length; i++) {
      const o = this.outline[i];
      o.setTexture(key);
      o.setFlipX(this.sprite.flipX);
      o.setOrigin(0.5, this.sprite.originY);
      o.setPosition(this.sprite.x + OUTLINE_OFFSETS[i][0], this.sprite.y + OUTLINE_OFFSETS[i][1]);
    }
  }

  /** oldY→newY로 발이 내려오며 가장 먼저 닿는 발판, 없으면 null */
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

  private updateState(running: boolean): void {
    const moving = Math.abs(this.vx) > 1;

    // 공격 — 최우선. 프레임 진행 후 마지막(뻗은) 자세 유지
    if (this.attackTimer > 0 && this.attack) {
      if (this.state !== 'attack') {
        this.state = 'attack';
        this.sprite.anims.stop();
      }
      const elapsed = this.attack.duration - this.attackTimer;
      const idx = Phaser.Math.Clamp(Math.floor(elapsed / this.attack.frameStep), 0, this.attack.frames - 1);
      this.sprite.setOrigin(0.5, this.attack.originY[idx]); // 프레임별 발 위치 보정
      this.sprite.setTexture(`${this.attack.texKey}_${idx}`);
      return;
    }

    // 공격이 아니면 기본 발 기준(origin)으로 복귀
    this.sprite.setOrigin(0.5, FOOT_RATIO);

    // 윈드업: 도약 직전 코일(웅크림) 자세 — 해당 점프 애니메이션의 마지막(깊은 웅크림) 프레임
    if (this.onGround && this.pendingJump !== null) {
      if (this.state !== 'crouch') {
        this.state = 'crouch';
        this.sprite.anims.stop();
      }
      this.sprite.setTexture(`${this.pendingJump}_${AIR_FRAMES[this.pendingJump] - 1}`);
      return;
    }

    if (!this.onGround) {
      const anim = this.airAnim ?? 'jump';
      if (this.state !== anim) {
        this.state = anim;
        this.sprite.anims.stop();
      }
      this.setAirFrame(anim);
      return;
    }

    this.airAnim = null;
    const desired: GroundState = moving ? (running ? 'run' : 'walk') : 'idle';
    if (desired === this.state) return;
    this.state = desired;

    if (desired === 'idle') {
      this.sprite.anims.stop();
      this.sprite.setTexture('walk_0');
    } else {
      this.sprite.play(desired);
    }
  }

  private setAirFrame(anim: AirAnim): void {
    const total = AIR_FRAMES[anim];
    const mid   = (total - 1) / 2;
    let idx: number;
    if (this.vy <= 0) {
      idx = Math.round((1 - this.vy / JUMP_VY) * mid);
    } else {
      idx = Math.round(mid + Math.min(this.vy / LAND_VY, 1) * (total - 1 - mid));
    }
    this.sprite.setTexture(`${anim}_${Phaser.Math.Clamp(idx, 0, total - 1)}`);
  }

  // ── 카메라 시스템이 읽는 상태 ──
  get focusX(): number { return this.sprite.x; }
  get focusY(): number { return this.sprite.y - BODY_CENTER_OFFSET; }
  get velX(): number { return this.vx; }
  get velY(): number { return this.vy; }
  get grounded(): boolean { return this.onGround; }
  /** 움직이지 않는 발판에 서 있는지(체크포인트 갱신용) */
  get onStableGround(): boolean {
    return this.onGround && !this.ground?.dx && !this.ground?.dy;
  }

  /** 착지한 프레임에 1회 true 반환 후 소비 */
  consumeLanded(): boolean {
    if (this.justLanded) { this.justLanded = false; return true; }
    return false;
  }

  // ── 공격 (크로스 펀치 / 레프트 잽) ──

  /** 공격 시작 (진행 중이면 무시) */
  attackWith(type: AttackType): void {
    if (this.attackTimer > 0) return;
    this.attack = ATTACKS[type];
    this.attackTimer = this.attack.duration;
    this.attackHasHit = false;
  }

  /** 바라보는 방향: 오른쪽 +1, 왼쪽 -1 */
  get facingDir(): number { return this.sprite.flipX ? -1 : 1; }

  /** 현재 공격의 넉백 정보(없으면 null) */
  get knockInfo(): KnockInfo | null {
    return this.attack ? { vx: this.attack.knockVx, vy: this.attack.knockVy } : null;
  }

  /** 현재 공격의 타격 연출 강도(0~1) */
  get attackJuice(): number { return this.attack?.juice ?? 1; }

  /** 공격 활성 구간이고 아직 명중 전이면 정면 히트박스 반환, 아니면 null */
  activeHitbox(): Hitbox | null {
    if (this.attackTimer <= 0 || this.attackHasHit || !this.attack) return null;
    const elapsed = this.attack.duration - this.attackTimer;
    if (elapsed < this.attack.activeStart || elapsed > this.attack.activeEnd) return null;

    const cx = this.sprite.x;
    const cy = this.focusY;
    const right = this.facingDir > 0;
    return {
      x1: right ? cx : cx - this.attack.reach,
      x2: right ? cx + this.attack.reach : cx,
      y1: cy - this.attack.halfH,
      y2: cy + this.attack.halfH,
    };
  }

  /** 명중 처리 — 이번 공격 동안 추가 명중 방지 */
  markHit(): void { this.attackHasHit = true; }

  /** 캐릭터 색 변경 (외곽선은 더 진한 동색계열로) */
  setColor(color: number): void {
    this.sprite.setTint(color);
    const dark = darken(color, OUTLINE_DARKEN);
    this.outline.forEach((o) => o.setTint(dark));
  }

  // ── 위치 / 리스폰 (체크포인트·함정용) ──
  get x(): number { return this.sprite.x; }
  get feetY(): number { return this.sprite.y; }
  get bounds(): Hitbox {
    const cx = this.sprite.x, cy = this.focusY;
    return { x1: cx - 16, x2: cx + 16, y1: cy - 32, y2: cy + 32 };
  }

  /** 체크포인트로 되돌리기 (모든 운동·공격 상태 초기화) */
  respawnAt(x: number, y: number): void {
    this.sprite.setPosition(x, y);
    this.vx = 0; this.vy = 0;
    this.onGround = false; this.ground = null;
    this.attackTimer = 0; this.pendingJump = null; this.crouchTimer = 0;
  }
}
