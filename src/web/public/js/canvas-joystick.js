// src/web/public/js/canvas-joystick.js
const canvas = document.getElementById("joystickCanvas");
const ctx = canvas.getContext("2d");

const cfg = {
  min: -100,
  max: 100,
  gridStep: 50
};

function toPxX(x) {
  const w = canvas.width;
  return Math.round(((x - cfg.min) / (cfg.max - cfg.min)) * w);
}

function toPxY(y) {
  const h = canvas.height;
  // y: + oben (mathematisch), Canvas: + unten => invertieren
  return Math.round(((cfg.max - y) / (cfg.max - cfg.min)) * h);
}

function drawGrid() {
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  // Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  // Gridlines
  ctx.strokeStyle = "#e9ecef";
  ctx.lineWidth = 1;

  for (let v = cfg.min; v <= cfg.max; v += cfg.gridStep) {
    // vertical lines
    const x = toPxX(v);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();

    // horizontal lines
    const y = toPxY(v);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Axes
  ctx.strokeStyle = "#6c757d";
  ctx.lineWidth = 2;

  // Y axis at x=0
  ctx.beginPath();
  ctx.moveTo(toPxX(0), 0);
  ctx.lineTo(toPxX(0), h);
  ctx.stroke();

  // X axis at y=0
  ctx.beginPath();
  ctx.moveTo(0, toPxY(0));
  ctx.lineTo(w, toPxY(0));
  ctx.stroke();
}

function drawPoint(x, y) {
  const px = toPxX(x);
  const py = toPxY(y);

  ctx.fillStyle = "red";
  ctx.beginPath();
  ctx.arc(px, py, 5, 0, Math.PI * 2);
  ctx.fill();
}

function loop() {
  drawGrid();
  const st = window.joystickState || { x: 0, y: 0 };
  drawPoint(st.x || 0, st.y || 0);
  requestAnimationFrame(loop);
}

loop();
