import Phaser from 'phaser';

/**
 * 배경/분위기 레이어.
 * - 높이에 따라 색이 변하는 그라데이션 하늘(정상=차가운 하늘, 바닥=따뜻한 노을빛).
 * - 패럴랙스 구름 + 원경 능선 실루엣: 카메라보다 느리게 흘러 공간감을 만든다.
 * 모든 텍스처는 에셋 없이 캔버스로 생성.
 */

const SKY_TOP = '#9fd4ee';
const SKY_MID = '#dceef4';
const SKY_BOT = '#ffe4c4';

const CLOUD_COUNT = 16;
const RIDGE_FAR_COLOR = 0xc7d5de;
const RIDGE_NEAR_COLOR = 0xaabfcc;

function ensureTexture(scene: Phaser.Scene, key: string, w: number, h: number,
  draw: (ctx: CanvasRenderingContext2D) => void): void {
  if (scene.textures.exists(key)) return;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  draw(canvas.getContext('2d')!);
  scene.textures.addCanvas(key, canvas);
}

export class Background {
  constructor(scene: Phaser.Scene, worldW: number, worldH: number) {
    const { width: screenW, height: screenH } = scene.scale;

    // 하늘 그라데이션 — 1px 폭 세로 그라데이션을 월드 크기로 늘림
    ensureTexture(scene, 'sky_grad', 1, 512, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 512);
      g.addColorStop(0, SKY_TOP);
      g.addColorStop(0.55, SKY_MID);
      g.addColorStop(1, SKY_BOT);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1, 512);
    });
    scene.add.image(worldW / 2, worldH / 2, 'sky_grad')
      .setDisplaySize(worldW, worldH).setDepth(-10);

    // 구름 — 흰 타원 뭉치
    ensureTexture(scene, 'cloud', 120, 44, (ctx) => {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      const blobs: [number, number, number, number][] = [
        [34, 30, 26, 12], [62, 24, 30, 14], [92, 30, 22, 11], [50, 34, 34, 9],
      ];
      for (const [x, y, rx, ry] of blobs) {
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // 원경 능선 — 완만한 봉우리 실루엣 (수평 타일링)
    ensureTexture(scene, 'ridge', 320, 96, (ctx) => {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, 96);
      ctx.lineTo(0, 56);
      const peaks = [[40, 30], [90, 48], [150, 22], [210, 44], [270, 30], [320, 52]];
      for (const [x, y] of peaks) ctx.lineTo(x, y);
      ctx.lineTo(320, 96);
      ctx.closePath();
      ctx.fill();
    });

    // 패럴랙스 배치: scrollFactor s에서 카메라 전 범위를 덮으려면
    // [0, screen + s*(world-screen)] 범위에 놓으면 된다.
    const span = (s: number, world: number, screen: number) => screen + s * (world - screen);

    const rand = seededRand(7);
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const s = 0.22 + rand() * 0.33;
      const x = rand() * span(s, worldW, screenW);
      const y = rand() * span(s, worldH, screenH) * 0.9;
      scene.add.image(x, y, 'cloud')
        .setScrollFactor(s)
        .setScale(0.8 + rand() * 1.4)
        .setAlpha(0.35 + rand() * 0.4)
        .setDepth(-9);
    }

    // 능선 2겹 — 화면 하단(월드 바닥 부근)에 깔림
    for (const [s, color, alpha, scaleY] of [
      [0.18, RIDGE_FAR_COLOR, 0.7, 1.6],
      [0.32, RIDGE_NEAR_COLOR, 0.8, 1.15],
    ] as const) {
      const w = span(s, worldW, screenW) + 320;
      const y = span(s, worldH, screenH);
      scene.add.tileSprite(0, y, w, 96, 'ridge')
        .setOrigin(0, 1).setScrollFactor(s)
        .setTint(color).setAlpha(alpha).setScale(1, scaleY)
        .setDepth(-8);
    }
  }
}

/** 항상 같은 배치가 나오도록 시드 고정된 의사난수 */
function seededRand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}
