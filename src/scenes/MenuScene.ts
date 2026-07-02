import Phaser from 'phaser';
import { defaultLevel, saveLevel, decodeLevel } from '../level/LevelData';
import { ensureDuskSky, ensureCloud, ensureRidge, seededRand } from '../systems/EnvTextures';

function makeRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

const ACCENT = '#ffd24a';
const PILL_FILL = 0x2a1f4d;
const PILL_STROKE = 0x8fb8e8;

interface Cloud { img: Phaser.GameObjects.Image; speed: number; }

export class MenuScene extends Phaser.Scene {
  private clouds: Cloud[] = [];

  constructor() {
    super({ key: 'MenuScene' });
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;

    ensureDuskSky(this);
    ensureCloud(this);
    ensureRidge(this);

    // 황혼 하늘
    this.add.image(cx, height / 2, 'sky_dusk').setDisplaySize(width, height).setDepth(-10);

    // 달 은은한 발광
    const moon = this.add.graphics().setDepth(-9);
    moon.fillStyle(0xfff3d6, 0.9).fillCircle(0, 0, 18);
    moon.fillStyle(0xfff3d6, 0.15).fillCircle(0, 0, 34);
    moon.setPosition(width - 64, 46);

    // 떠다니는 구름 (은은하게 좌→우 드리프트)
    const rand = seededRand(11);
    this.clouds = [];
    for (let i = 0; i < 6; i++) {
      const img = this.add.image(rand() * width, 24 + rand() * 90, 'cloud')
        .setScale(0.5 + rand() * 0.6).setAlpha(0.18 + rand() * 0.15)
        .setTint(0xcdb6e8).setDepth(-8);
      this.clouds.push({ img, speed: 4 + rand() * 6 });
    }

    // 원경 능선 실루엣
    this.add.tileSprite(0, height, width + 40, 96, 'ridge')
      .setOrigin(0, 1).setTint(0x140f2b).setAlpha(0.85).setDepth(-7);
    this.add.tileSprite(0, height, width + 40, 70, 'ridge')
      .setOrigin(0, 1).setTint(0x1f1740).setAlpha(0.9).setScale(1.15, 0.8).setDepth(-6);

    // 타이틀 — 스트로크 + 섀도우로 임팩트
    this.add.text(cx, 46, 'HOP ON TOP', {
      fontSize: '38px', color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(1)
      .setStroke('#140f2b', 8)
      .setShadow(0, 4, '#00000066', 6, true, true);

    this.add.text(cx, 80, '탑 등반 PvP', {
      fontSize: '12px', color: ACCENT, fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(1);

    // 메뉴 항목 — 필(pill) 버튼
    const items: [string, string, () => void][] = [
      ['▶', '솔로 플레이', () => this.scene.start('GameScene')],
      ['✎', '맵 만들기', () => this.scene.start('EditorScene')],
      ['◆', '기본 맵', () => { saveLevel(defaultLevel()); this.scene.start('GameScene'); }],
      ['⤓', '코드 불러오기', () => this.loadFromCode()],
      ['●', '방 만들기 (멀티)', () => this.createRoom()],
      ['○', '방 참가 (멀티)', () => this.joinRoom()],
    ];
    const btnW = 250, btnH = 34, gap = 8;
    const startY = 122;
    items.forEach(([icon, label, cb], i) => this.pillButton(cx, startY + i * (btnH + gap), btnW, btnH, icon, label, cb));
  }

  update(_time: number, delta: number): void {
    const dt = delta / 1000;
    const { width } = this.scale;
    for (const c of this.clouds) {
      c.img.x += c.speed * dt;
      if (c.img.x - 80 > width) c.img.x = -80;
    }
  }

  private pillButton(cx: number, cy: number, w: number, h: number, icon: string, label: string, cb: () => void): void {
    const x = cx - w / 2, y = cy - h / 2;
    const r = h / 2;

    const g = this.add.graphics({ x, y }).setDepth(1);
    const drawPill = (fillAlpha: number, strokeAlpha: number) => {
      g.clear();
      g.fillStyle(PILL_FILL, fillAlpha).fillRoundedRect(0, 0, w, h, r);
      g.lineStyle(1.5, PILL_STROKE, strokeAlpha).strokeRoundedRect(0, 0, w, h, r);
    };
    drawPill(0.55, 0.35);

    const txt = this.add.text(cx, cy, `${icon}  ${label}`, {
      fontSize: '15px', color: '#ffffff', fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(2);

    g.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains)
      .on('pointerover', () => {
        drawPill(0.85, 0.9);
        txt.setColor(ACCENT);
        this.tweens.add({ targets: [g, txt], scaleX: 1.03, scaleY: 1.03, duration: 120, ease: 'Quad.Out' });
      })
      .on('pointerout', () => {
        drawPill(0.55, 0.35);
        txt.setColor('#ffffff');
        this.tweens.add({ targets: [g, txt], scaleX: 1, scaleY: 1, duration: 120, ease: 'Quad.Out' });
      })
      .on('pointerdown', () => {
        this.tweens.add({
          targets: [g, txt], scaleX: 0.96, scaleY: 0.96, duration: 60, yoyo: true, ease: 'Quad.Out',
        });
      })
      .on('pointerup', cb);
  }

  private createRoom(): void {
    this.registry.set('roomCode', makeRoomCode());
    this.registry.set('isHost', true);
    this.scene.start('LobbyScene');
  }

  private joinRoom(): void {
    const code = window.prompt('방 코드를 입력하세요:');
    if (!code) return;
    this.registry.set('roomCode', code.trim().toUpperCase());
    this.registry.set('isHost', false);
    this.scene.start('LobbyScene');
  }

  private loadFromCode(): void {
    const code = window.prompt('맵 코드를 붙여넣으세요:');
    if (!code) return;
    const lv = decodeLevel(code);
    if (!lv) { window.alert('잘못된 맵 코드예요.'); return; }
    saveLevel(lv);
    this.scene.start('GameScene');
  }
}
