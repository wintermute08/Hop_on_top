import Phaser from 'phaser';

/**
 * 방 로비 — 멀티플레이 대비 스캐폴드.
 * 지금은 네트워킹 없이 로컬로 동작(방 코드/플레이어 목록 UI만).
 * 추후 실제 서버 연결 시 이 화면에 원격 플레이어가 채워지고 호스트가 시작을 누른다.
 */
export class LobbyScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LobbyScene' });
  }

  create(): void {
    const { width, height } = this.scale;
    const roomCode = (this.registry.get('roomCode') as string) ?? '------';
    const isHost = (this.registry.get('isHost') as boolean) ?? true;

    this.add.rectangle(width / 2, height / 2, width, height, 0x1a1a2e);

    this.add.text(width / 2, 34, isHost ? '방 만들기' : '방 참가', {
      fontSize: '22px', color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5);

    // 방 코드
    this.add.text(width / 2, 74, '방 코드', {
      fontSize: '11px', color: '#8fb8e8', fontFamily: 'monospace',
    }).setOrigin(0.5);
    this.add.text(width / 2, 98, roomCode, {
      fontSize: '30px', color: '#ffd24a', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.add.text(width / 2, 124, '친구에게 이 코드를 공유하세요', {
      fontSize: '10px', color: '#888888', fontFamily: 'monospace',
    }).setOrigin(0.5);

    // 플레이어 슬롯
    const slots = ['P1  (나)', '대기 중…', '대기 중…', '대기 중…'];
    slots.forEach((s, i) => {
      const filled = i === 0;
      this.add.text(width / 2, 158 + i * 22, s, {
        fontSize: '13px',
        color: filled ? '#a8d8a0' : '#555555',
        fontFamily: 'monospace',
      }).setOrigin(0.5);
    });

    // 버튼
    if (isHost) {
      this.button(width / 2, 262, '▶  게임 시작', () => this.scene.start('GameScene'));
    } else {
      this.add.text(width / 2, 262, '호스트가 시작하기를 기다리는 중…', {
        fontSize: '11px', color: '#888888', fontFamily: 'monospace',
      }).setOrigin(0.5);
    }
    this.button(width / 2, 296, '←  나가기', () => this.scene.start('MenuScene'));

    // 안내(스캐폴드)
    this.add.text(width / 2, height - 12, '※ 온라인 연결 준비 중 — 현재는 로컬 플레이', {
      fontSize: '9px', color: '#666666', fontFamily: 'monospace',
    }).setOrigin(0.5, 1);
  }

  private button(x: number, y: number, label: string, cb: () => void): void {
    const t = this.add.text(x, y, label, {
      fontSize: '16px', color: '#ffffff', fontFamily: 'monospace',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    t.on('pointerover', () => t.setColor('#ffcc00'));
    t.on('pointerout', () => t.setColor('#ffffff'));
    t.on('pointerup', cb);
  }
}
