import Phaser from 'phaser';
import { MenuScene } from './scenes/MenuScene';
import { LobbyScene } from './scenes/LobbyScene';
import { GameScene } from './scenes/GameScene';
import { EditorScene } from './scenes/EditorScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  backgroundColor: '#1a1a2e',
  pixelArt: true,
  disableContextMenu: true, // 우클릭(지우개) 시 메뉴 방지
  scale: {
    mode: Phaser.Scale.FIT,            // 비율 유지하며 창에 꽉 차게
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 640,
    height: 360,
  },
  scene: [MenuScene, LobbyScene, GameScene, EditorScene],
};

new Phaser.Game(config);
