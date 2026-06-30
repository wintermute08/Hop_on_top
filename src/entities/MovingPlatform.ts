import type { Platform } from './Player';

export type MoveMode = 'horizontal' | 'vertical';

/**
 * 왕복 이동 발판(사각 블록). surface(x,y,w)를 매 프레임 갱신하며,
 * dx/dy(이번 프레임 이동량)를 기록해 위에 선 캐릭터를 함께 실어 나른다.
 */
export class MovingPlatform {
  readonly surface: Platform;
  private body: Phaser.GameObjects.Rectangle;
  private edge: Phaser.GameObjects.Rectangle;
  private arrow: Phaser.GameObjects.Text;
  private mode: MoveMode;
  private baseX: number;
  private baseY: number;
  private range: number;
  private omega: number;
  private phase: number;

  constructor(
    scene: Phaser.Scene, x: number, y: number, w: number, h: number,
    mode: MoveMode, range: number, period: number, phase = 0,
  ) {
    this.mode = mode;
    this.baseX = x;
    this.baseY = y;
    this.range = range;
    this.omega = (Math.PI * 2) / period;
    this.phase = phase;
    this.surface = { x, y, w, dx: 0, dy: 0 };

    this.body = scene.add.rectangle(x, y, w, h, 0xc9a063).setOrigin(0, 0)
      .setStrokeStyle(2, 0x8a6a30).setDepth(5);
    this.edge = scene.add.rectangle(x, y, w, 4, 0xffe6a0).setOrigin(0, 0).setDepth(6);
    this.arrow = scene.add.text(x + w / 2, y + h / 2, mode === 'horizontal' ? '↔' : '↕', {
      fontSize: '16px', color: '#5a3d10', fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(6);
  }

  update(delta: number): void {
    this.phase += this.omega * (delta / 1000);
    const off = Math.sin(this.phase) * this.range;
    const nx = this.mode === 'horizontal' ? this.baseX + off : this.baseX;
    const ny = this.mode === 'vertical' ? this.baseY + off : this.baseY;

    this.surface.dx = nx - this.surface.x;
    this.surface.dy = ny - this.surface.y;
    this.surface.x = nx;
    this.surface.y = ny;

    this.body.setPosition(nx, ny);
    this.edge.setPosition(nx, ny);
    this.arrow.setPosition(nx + this.body.width / 2, ny + this.body.height / 2);
  }
}
