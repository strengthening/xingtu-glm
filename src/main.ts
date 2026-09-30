import './style.css';

// 骨架占位：建立 WebGL 上下文与渲染循环，后续由 render/ 模块接管。
const canvas = document.getElementById('sky') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { antialias: true });

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
}

function frame(): void {
  if (gl) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.004, 0.006, 0.014, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
resize();
frame();
