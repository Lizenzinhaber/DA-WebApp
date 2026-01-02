// src/web/public/js/websocket-client.js
const socket = io(); // same origin

window.joystickState = {
  x: 0,
  y: 0,
  raw: { fsr1: 0, fsr2: 0, fsr3: 0, fsr4: 0 },
  source: "simulation",
  ts: 0,
  lastHz: 0
};

let lastTs = 0;

socket.on("joystick:update", (payload) => {
  window.joystickState = payload;

  if (lastTs) {
    const dt = payload.ts - lastTs;
    if (dt > 0) window.joystickState.lastHz = Math.round(1000 / dt);
  }
  lastTs = payload.ts;

  // UI Textfelder (falls vorhanden)
  const elX = document.getElementById("val-x");
  const elY = document.getElementById("val-y");
  const elF1 = document.getElementById("val-fsr1");
  const elF2 = document.getElementById("val-fsr2");
  const elF3 = document.getElementById("val-fsr3");
  const elF4 = document.getElementById("val-fsr4");
  const elSrc = document.getElementById("val-source");
  const elHz = document.getElementById("val-hz");

  if (elX) elX.textContent = payload.x;
  if (elY) elY.textContent = payload.y;
  if (elF1) elF1.textContent = payload.raw.fsr1;
  if (elF2) elF2.textContent = payload.raw.fsr2;
  if (elF3) elF3.textContent = payload.raw.fsr3;
  if (elF4) elF4.textContent = payload.raw.fsr4;
  if (elSrc) elSrc.textContent = payload.source;
  if (elHz) elHz.textContent = window.joystickState.lastHz || "-";
});
