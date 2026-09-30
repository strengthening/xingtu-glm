import './style.css';
import { Engine } from './core/engine';

const canvas = document.getElementById('sky') as HTMLCanvasElement;
const engine = new Engine(canvas);

void engine.init().then(() => {
  engine.start();
  console.log('xingtu 引擎已启动');
});

// 调试钩子：浏览器控制台可实时调整状态
Object.assign(window, { xingtu: engine });
