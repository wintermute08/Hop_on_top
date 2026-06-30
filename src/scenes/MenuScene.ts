import Phaser from 'phaser';
import { defaultLevel, saveLevel, decodeLevel } from '../level/LevelData';

function makeRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MenuScene' });
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    this.add.rectangle(cx, height / 2, width, height, 0x1a1a2e);

    this.add.text(cx, 44, 'HOP ON TOP', {
      fontSize: '36px', color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.add.text(cx, 76, '탑 등반 PvP', {
      fontSize: '12px', color: '#8fb8e8', fontFamily: 'monospace',
    }).setOrigin(0.5);

    // 메뉴 항목을 중앙 기준으로 균등 배치
    const items: [string, () => void][] = [
      ['▶  솔로 플레이', () => this.scene.start('GameScene')],
      ['✎  맵 만들기', () => this.scene.start('EditorScene')],
      ['◆  기본 맵', () => { saveLevel(defaultLevel()); this.scene.start('GameScene'); }],
      ['⤓  코드 불러오기', () => this.loadFromCode()],
      ['●  방 만들기 (멀티)', () => this.createRoom()],
      ['○  방 참가 (멀티)', () => this.joinRoom()],
    ];
    const gap = 30;
    const startY = 124;
    items.forEach(([label, cb], i) => this.button(cx, startY + i * gap, label, cb));
  }

  private button(x: number, y: number, label: string, cb: () => void): void {
    const t = this.add.text(x, y, label, {
      fontSize: '17px', color: '#ffffff', fontFamily: 'monospace',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    t.on('pointerover', () => t.setColor('#ffcc00'));
    t.on('pointerout', () => t.setColor('#ffffff'));
    t.on('pointerup', cb);
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
