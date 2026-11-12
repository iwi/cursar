import Phaser from 'phaser';
import { RaceScene, type RaceSceneData } from './RaceScene';

export function createGame(parent: HTMLElement, data: RaceSceneData): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#0b0d12',
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    render: { antialias: true, roundPixels: false },
    audio: { noAudio: true },
    banner: false,
    scene: new RaceScene(data),
  });
}
