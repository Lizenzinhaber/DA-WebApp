// src/services/simulation/simulationSource.js
const EventEmitter = require("node:events");

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * SimulationSource erzeugt zyklisch (fsr1..fsr4) als Rohdaten 0..4095
 * und emittiert sie als Event: "data".
 *
 * Ziel: komplette Verarbeitungskette testen (Simulation -> Processing -> Socket.IO -> UI).
 */
class SimulationSource extends EventEmitter {
  constructor({
    hz = 50,
    radius = 80,      // Kreisradius in %-Skala (0..100)
    periodMs = 4000   // Dauer einer Umdrehung
  } = {}) {
    super();
    this.hz = hz;
    this.radius = radius;
    this.periodMs = periodMs;
    this.timer = null;
  }

  start() {
    if (this.timer) return;

    const intervalMs = Math.round(1000 / this.hz);

    this.timer = setInterval(() => {
      const now = Date.now();
      const phase = (now % this.periodMs) / this.periodMs; // 0..1
      const angle = 2 * Math.PI * phase;

      // Uhrzeigersinn: mathematisch erreicht man das durch -sin(...)
      const xIdeal = Math.round(this.radius * Math.cos(angle));
      const yIdeal = Math.round(-this.radius * Math.sin(angle));

      // Rückrechnung auf FSR so, dass später serverseitig wieder gilt:
      // x = fsr2 - fsr4, y = fsr1 - fsr3 (nach Normierung)
      // diff in [-4095..4095]
      const diffX = Math.round((xIdeal / 100) * 4095);
      const diffY = Math.round((yIdeal / 100) * 4095);

      // Symmetrisch um Mitte -> verhindert dauerndes Clamping bei großen Amplituden
      const mid = 2048;

      const fsr2 = clamp(mid + Math.round(diffX / 2), 0, 4095);
      const fsr4 = clamp(mid - Math.round(diffX / 2), 0, 4095);

      const fsr1 = clamp(mid + Math.round(diffY / 2), 0, 4095);
      const fsr3 = clamp(mid - Math.round(diffY / 2), 0, 4095);

      this.emit("data", {
        fsr1, fsr2, fsr3, fsr4,
        source: "simulation",
        ts: now
      });
    }, intervalMs);
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { SimulationSource };
