import Phaser from 'phaser';

/** 씬 간 공유되는 배경용 캔버스 텍스처(하늘/구름/능선) 생성. 이미 있으면 재생성하지 않음. */

export function ensureTexture(
  scene: Phaser.Scene, key: string, w: number, h: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): void {
  if (scene.textures.exists(key)) return;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  draw(canvas.getContext('2d')!);
  scene.textures.addCanvas(key, canvas);
}

/** 낮 하늘(위=차가움, 아래=노을) — 인게임 배경용 */
export function ensureDaySky(scene: Phaser.Scene): void {
  ensureTexture(scene, 'sky_grad', 1, 512, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#9fd4ee');
    g.addColorStop(0.55, '#dceef4');
    g.addColorStop(1, '#ffe4c4');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1, 512);
  });
}

/** 황혼 하늘(위=인디고, 아래=보랏빛 노을) — 메뉴 화면용 */
export function ensureDuskSky(scene: Phaser.Scene): void {
  ensureTexture(scene, 'sky_dusk', 1, 512, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#191233');
    g.addColorStop(0.5, '#3a2a63');
    g.addColorStop(0.82, '#7a4a6b');
    g.addColorStop(1, '#a8654f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1, 512);
  });
}

export function ensureCloud(scene: Phaser.Scene): void {
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
}

export function ensureRidge(scene: Phaser.Scene): void {
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
}

/** 항상 같은 배치가 나오도록 시드 고정된 의사난수 */
export function seededRand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}
