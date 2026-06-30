import type { Player } from '../entities/Player';

/**
 * 관성 기반 카메라.
 * - 완전 고정 추적이 아니라 목표 지점으로 부드럽게 따라간다(점프=늦게, 착지=눌림).
 * - Look Ahead: 이동 방향을 미리, 상승 시 위쪽을 더 보여준다.
 * - 스프링 오프셋: 착지/공격/넉백/대시 충격을 흡수하며 복귀.
 * - Shake & Zoom punch: 타격감 연출 훅(추후 PvP에서 호출).
 */

// 따라가기 부드러움 (클수록 덜 늦게 = 더 빠르게 붙음 = 텐션↑)
const FOLLOW_X_K = 8;
const FOLLOW_Y_K = 11;

// Look Ahead — 더 멀리, 더 빠르게 기울여 텐션감
const LOOK_X      = 115;  // 이동 방향 선행 거리
const LOOK_UP     = 100;  // 상승 중 추가로 위를 보는 거리
const LOOK_DOWN   = 55;   // 빠르게 낙하할 때 아래를 미리 봄
const LOOK_LERP_K = 7;    // look-ahead 변화 속도(빠를수록 즉각적)
const REF_VY      = 430;  // 속도 정규화 기준(점프 도약 속도)

// 화면 내 플레이어 위치: 위로 올릴수록 머리 위 공간(다음 발판)이 더 보임
const Y_BIAS = 55;

// 스프링(착지 눌림 / 충격 오프셋) — 탱탱하게: 강성↑로 빠른 스냅, 가벼운 오버슈트
const SPRING_STIFFNESS = 200;
const SPRING_DAMPING   = 18;
const LAND_PUSH        = 200; // 착지 시 아래로 누르는 속도 임펄스

export class CameraController {
  private cam: Phaser.Cameras.Scene2D.Camera;
  private target: Player;

  private camX: number;
  private camY: number;
  private lookX = 0;
  private lookY = 0;

  // 스프링 오프셋 (착지/공격/넉백/대시 공용)
  private offX = 0;
  private offY = 0;
  private offVx = 0;
  private offVy = 0;

  // shake
  private shakeTime = 0;
  private shakeDur = 0;
  private shakeMag = 0;

  // zoom
  private zoomTarget = 1;

  constructor(scene: Phaser.Scene, target: Player) {
    this.cam = scene.cameras.main;
    this.target = target;
    this.camX = target.focusX;
    this.camY = target.focusY;
  }

  update(delta: number): void {
    const dt = delta / 1000;

    // 1) Look Ahead 목표 계산 (속도에 비례해 적극적으로 기울임)
    const speedRatio = Phaser.Math.Clamp(this.target.velX / 180, -1, 1);
    const lookXTarget = speedRatio * LOOK_X;
    const vy = this.target.velY;
    const lookYTarget = vy < 0
      ? Math.max(vy / REF_VY, -1) * LOOK_UP   // 상승: 도약 직후 가장 강하게 위로
      : Math.min(vy / REF_VY, 1) * LOOK_DOWN; // 하강: 빠를수록 아래를 미리
    this.lookX = expLerp(this.lookX, lookXTarget, LOOK_LERP_K, dt);
    this.lookY = expLerp(this.lookY, lookYTarget, LOOK_LERP_K, dt);

    // 2) 관성 추적 (목표 = 플레이어 + look ahead - 상단 여백)
    const tx = this.target.focusX + this.lookX;
    const ty = this.target.focusY + this.lookY - Y_BIAS;
    this.camX = expLerp(this.camX, tx, FOLLOW_X_K, dt);
    this.camY = expLerp(this.camY, ty, FOLLOW_Y_K, dt);

    // 3) 착지 눌림
    if (this.target.consumeLanded()) {
      this.offVy += LAND_PUSH;
    }

    // 4) 스프링 오프셋 적분
    this.offVx += (-SPRING_STIFFNESS * this.offX - SPRING_DAMPING * this.offVx) * dt;
    this.offVy += (-SPRING_STIFFNESS * this.offY - SPRING_DAMPING * this.offVy) * dt;
    this.offX += this.offVx * dt;
    this.offY += this.offVy * dt;

    // 5) shake
    let shakeX = 0, shakeY = 0;
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const k = Math.max(this.shakeTime / this.shakeDur, 0);
      shakeX = (Math.random() * 2 - 1) * this.shakeMag * k;
      shakeY = (Math.random() * 2 - 1) * this.shakeMag * k;
    }

    // 6) zoom 복귀
    this.cam.zoom = expLerp(this.cam.zoom, this.zoomTarget, 10, dt);
    this.zoomTarget = expLerp(this.zoomTarget, 1, 6, dt);

    // 7) 최종 스크롤 (중앙 정렬) — 경계는 setBounds가 클램프
    const cx = this.camX + this.offX + shakeX;
    const cy = this.camY + this.offY + shakeY;
    this.cam.centerOn(cx, cy);
  }

  // ── 연출 훅 (PvP/대시에서 호출) ──

  /** 방향 충격: 공격 밀림, 넉백, 대시 가속 등 */
  impulse(dx: number, dy: number): void {
    this.offVx += dx;
    this.offVy += dy;
  }

  shake(duration = 0.12, magnitude = 8): void {
    this.shakeTime = duration;
    this.shakeDur = duration;
    this.shakeMag = magnitude;
  }

  zoomPunch(amount = 1.02): void {
    this.cam.zoom = amount;
    this.zoomTarget = 1;
  }

  /** 타격 성공 종합 연출 (strength 0~1로 가벼운 잽 ~ 묵직한 펀치) */
  hitJuice(dirX: number, strength = 1): void {
    this.shake(0.08 + 0.05 * strength, 4 + 6 * strength);
    this.zoomPunch(1 + 0.022 * strength);
    this.impulse(Math.sign(dirX) * (30 + 40 * strength), -20 * strength);
  }
}

/** 프레임레이트 독립 지수 감쇠 보간 */
function expLerp(current: number, target: number, k: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-k * dt));
}
