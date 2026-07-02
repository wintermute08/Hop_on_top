import Phaser from 'phaser';
import { ensureDaySky, ensureCloud, ensureRidge, seededRand } from './EnvTextures';

/**
 * 인게임 배경/분위기 레이어.
 * - 높이에 따라 색이 변하는 그라데이션 하늘(정상=차가운 하늘, 바닥=따뜻한 노을빛).
 * - 패럴랙스 구름 + 원경 능선 실루엣: 카메라보다 느리게 흘러 공간감을 만든다.
 */

const CLOUD_COUNT = 16;
const RIDGE_FAR_COLOR = 0xc7d5de;
const RIDGE_NEAR_COLOR = 0xaabfcc;

export class Background {
  constructor(scene: Phaser.Scene, worldW: number, worldH: number) {
    ensureDaySky(scene);
    ensureCloud(scene);
    ensureRidge(scene);

    const { width: screenW, height: screenH } = scene.scale;

    scene.add.image(worldW / 2, worldH / 2, 'sky_grad')
      .setDisplaySize(worldW, worldH).setDepth(-10);

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
