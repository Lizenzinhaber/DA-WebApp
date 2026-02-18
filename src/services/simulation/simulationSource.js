/**
 * @file simulationSource.js
 * @brief Simulierte Sensor-Datenquelle für Tests/Demo
 * 
 * Gibt zirkuläre Bewegungsmuster aus (hilfreich zum Debuggen)
 * Kompatibel mit UARTSource API für nahtlose Integration
 */

const { EventEmitter } = require("events");

class SimulationSource extends EventEmitter {
  /**
   * @param {Object} options - Konfiguration
   * @param {number} options.hz - Sampling-Rate (z.B. 50 Hz)
   * @param {number} options.radius - Radius der zirkulären Bewegung [0...100]
   * @param {number} options.periodMs - Periode der zirkulären Bewegung [ms]
   */
  constructor({ hz = 50, radius = 80, periodMs = 4000 } = {}) {
    super();

    this.hz = hz;
    this.radius = radius;
    this.periodMs = periodMs;

    this.isRunning = false;
    this.intervalId = null;
    this.messageCount = 0;
    this.startTime = 0;
  }

  /**
   * Starte Simulation
   * @returns {Promise<void>}
   */
  async start() {
    if (this.isRunning) {
      return;
    }

    console.log(`[SimulationSource] Starting simulation @ ${this.hz} Hz`);
    this.isRunning = true;
    this.messageCount = 0;
    this.startTime = Date.now();

    const intervalMs = 1000 / this.hz;

    this.intervalId = setInterval(() => {
      this._generateSensorData();
    }, intervalMs);

    this.emit("started");
  }

  /**
   * Stoppe Simulation
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    console.log(`[SimulationSource] Stopped (${this.messageCount} messages)`);
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.emit("stopped");
  }

  /**
   * Generiere simulierte Sensordaten
   * @private
   */
  _generateSensorData() {
    const now = Date.now();
    const elapsed = now - this.startTime;
    const phase = (elapsed % this.periodMs) / this.periodMs;
    const angle = phase * 2 * Math.PI;

    // Zirkuläre Bewegung
    const vx = Math.sin(angle); // [-1...+1]
    const vy = Math.cos(angle); // [-1...+1]

    // Simuliere Rohwerte basierend auf Vektor
    const maxRaw = 4095;
    const centering = maxRaw / 2; // 2047

    // Rohwerte berechnen aus Vektor
    // Einfaches Modell: normalisierte Vektor-Komponenten zu rohen ADC-Werten
    const u = Math.max(0, Math.min(maxRaw, centering - vy * 800)); // up
    const l = Math.max(0, Math.min(maxRaw, centering - vx * 800)); // left
    const d = Math.max(0, Math.min(maxRaw, centering + vy * 800)); // down
    const r = Math.max(0, Math.min(maxRaw, centering + vx * 800)); // right

    // Gefilterte Werte = leicht verzögert
    const filtered = {
      u: Math.round(u * 0.95),
      l: Math.round(l * 0.95),
      d: Math.round(d * 0.95),
      r: Math.round(r * 0.95)
    };

    const data = {
      ts: now,
      source: "simulation",
      raw: {
        u: Math.round(u),
        l: Math.round(l),
        d: Math.round(d),
        r: Math.round(r)
      },
      filtered: filtered,
      normalized: {
        u: u / maxRaw,
        l: l / maxRaw,
        d: d / maxRaw,
        r: r / maxRaw
      },
      vx: vx,
      vy: vy
    };

    this.messageCount++;
    this.emit("data", data);
  }

  /**
   * Gibt Status aus
   * @returns {Object}
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      messageCount: this.messageCount,
      hz: this.hz,
      radius: this.radius,
      periodMs: this.periodMs
    };
  }
}

module.exports = { SimulationSource };
