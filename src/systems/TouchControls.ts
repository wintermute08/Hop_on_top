import Phaser from 'phaser';

/**
 * 모바일 가상 조작.
 * - 왼쪽 절반 아무 곳이나 터치하면 그 지점에 조이스틱이 뜨는 floating pad(좌우 슬라이더).
 * - 오른쪽 하단: 점프 + 공격(잽/크로스) 버튼.
 * Player가 읽는 TouchInput 인터페이스를 이 클래스가 그대로 구현한다.
 */

const PAD_R = 46;         // 조이스틱 반경(드래그 클램프 범위)
const PAD_DEADZONE = 8;   // 이 이하 드래그는 무시
const PAD_RUN_RATIO = 0.6; // 이 비율 이상 당기면 달리기로 판정
const ZONE_W_RATIO = 0.55; // 화면 왼쪽 이 비율까지가 조이스틱 캡처 영역

const BTN_ALPHA = 0.28;
const BTN_ALPHA_PRESS = 0.55;

export interface TouchInput {
  readonly left: boolean;
  readonly right: boolean;
  readonly running: boolean;
  consumeJump(): boolean;
}

export class TouchControls implements TouchInput {
  left = false;
  right = false;
  running = false;
  private jumpPressed = false;

  private padBase: Phaser.GameObjects.Arc;
  private padKnob: Phaser.GameObjects.Arc;
  private padPointerId: number | null = null;
  private padCenterX = 0;
  private padCenterY = 0;

  private objects: Phaser.GameObjects.Components.Visible[] = [];

  constructor(scene: Phaser.Scene, onJab: () => void, onCross: () => void) {
    const { width, height } = scene.scale;

    // 왼쪽 절반: 조이스틱 캡처 영역 (터치 즉시 그 자리에 패드 생성)
    const zone = scene.add.zone(0, 0, width * ZONE_W_RATIO, height)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(1500).setInteractive();
    zone.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.padPointerId !== null) return;
      this.padPointerId = p.id;
      this.padCenterX = p.x;
      this.padCenterY = p.y;
      this.padBase.setPosition(p.x, p.y).setVisible(true);
      this.padKnob.setPosition(p.x, p.y).setVisible(true);
    });

    this.padBase = scene.add.circle(0, 0, PAD_R, 0xffffff, 0.12)
      .setStrokeStyle(2, 0xffffff, 0.3).setScrollFactor(0).setDepth(1501).setVisible(false);
    this.padKnob = scene.add.circle(0, 0, PAD_R * 0.48, 0xffffff, 0.3)
      .setScrollFactor(0).setDepth(1502).setVisible(false);

    scene.input.on('pointermove', this.onPointerMove, this);
    scene.input.on('pointerup', this.onPointerUp, this);
    scene.input.on('pointerupoutside', this.onPointerUp, this);

    // 오른쪽 하단: 점프 + 공격 버튼
    const jumpBtn = this.circleButton(scene, width - 44, height - 56, 30, '▲', 0x8fb8e8);
    jumpBtn.on('pointerdown', () => { this.jumpPressed = true; });

    const jabBtn = this.circleButton(scene, width - 106, height - 40, 23, 'X', 0xe8d888);
    jabBtn.on('pointerdown', onJab);

    const crossBtn = this.circleButton(scene, width - 84, height - 96, 25, 'Z', 0xe08585);
    crossBtn.on('pointerdown', onCross);

    this.objects.push(zone, this.padBase, this.padKnob, jumpBtn, jabBtn, crossBtn);
  }

  private circleButton(
    scene: Phaser.Scene, x: number, y: number, r: number, label: string, color: number,
  ): Phaser.GameObjects.Arc {
    const btn = scene.add.circle(x, y, r, color, BTN_ALPHA)
      .setStrokeStyle(2, 0xffffff, 0.4).setScrollFactor(0).setDepth(1501).setInteractive();
    const txt = scene.add.text(x, y, label, {
      fontSize: `${Math.round(r * 0.9)}px`, color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1502);
    btn.on('pointerdown', () => btn.setFillStyle(color, BTN_ALPHA_PRESS));
    btn.on('pointerup', () => btn.setFillStyle(color, BTN_ALPHA));
    btn.on('pointerout', () => btn.setFillStyle(color, BTN_ALPHA));
    this.objects.push(txt);
    return btn;
  }

  private onPointerMove(p: Phaser.Input.Pointer): void {
    if (p.id !== this.padPointerId) return;
    const dx = Phaser.Math.Clamp(p.x - this.padCenterX, -PAD_R, PAD_R);
    this.padKnob.setPosition(this.padCenterX + dx, this.padCenterY);
    this.left = dx < -PAD_DEADZONE;
    this.right = dx > PAD_DEADZONE;
    this.running = Math.abs(dx) > PAD_R * PAD_RUN_RATIO;
  }

  private onPointerUp(p: Phaser.Input.Pointer): void {
    if (p.id !== this.padPointerId) return;
    this.padPointerId = null;
    this.left = false; this.right = false; this.running = false;
    this.padBase.setVisible(false);
    this.padKnob.setVisible(false);
  }

  consumeJump(): boolean {
    if (this.jumpPressed) { this.jumpPressed = false; return true; }
    return false;
  }

  setVisible(v: boolean): void {
    this.objects.forEach((o) => o.setVisible(v));
  }
}
