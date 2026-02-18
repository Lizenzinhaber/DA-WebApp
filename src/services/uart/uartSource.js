/**
 * @file uartSource.js
 * @brief Bidirektionale UART-Datenquelle (Ersatz für SimulationSource)
 * 
 * Architektur:
 *   UARTClient (Protokoll/Port) → UARTSource (Wrapper) → SensorProcessor → Socket.IO
 * 
 * Verantwortlichkeit:
 *  - Verbindungsmanagement
 *  - Normalisierte Event-Emission
 *  - Fehlerbehandlung und Logging
 *  - Graceful Start/Stop
 */

const { EventEmitter } = require("events");
const { UARTClient } = require("./uartClient");

/**
 * Normalisiere Sensor-Werte zu [0...1] 
 * Algorithmus (aus ESP32 fsr_service.cpp):
 *   normalized = constrain((value - VG) / (VMAX - VG), 0, 1)
 * 
 * Mapping (aus Payload):
 *   idx[0] = up/top
 *   idx[1] = left
 *   idx[2] = down
 *   idx[3] = right
 * 
 * @param {Array<number>} values - Array von 4 uint16 Werten (raw oder filtered)
 * @returns {Array<number>} Array von 4 normalisierten Werten [0...1]
 */
function normalizeValues(values) {
  const VG = 500;     // Noise Gate Schwelle (aus ESP32)
  const VMAX = 4000;  // Full Scale (aus ESP32)
  
  return values.map((val) => {
    if (val <= VG) {
      return 0.0;
    }
    const normalized = (val - VG) / (VMAX - VG);
    return Math.max(0, Math.min(1, normalized)); // Clamp to [0, 1]
  });
}

class UARTSource extends EventEmitter {
  constructor({ port, baudRate = 115200, logging = true } = {}) {
    super();

    this.port = port;
    this.baudRate = baudRate;
    this.logging = logging;

    this.client = new UARTClient({
      port: this.port,
      baudRate: this.baudRate,
      logging: this.logging
    });

    this.isRunning = false;
    this.messageCount = 0;
    this.lastEmitTime = 0;
    this.emitInterval = 0; // ms zwischen Emits (0 = jede Nachricht)
    this.lastFrameTime = Date.now();
    this.frequency = 0;
    this.frameTimeDeltas = [];

    this._setupClientListeners();
  }

  /**
   * Konfiguriere UARTClient Event-Listener
   * @private
   */
  _setupClientListeners() {
    // Sensor-Daten empfangen
    this.client.on("sensordata", (sensorData) => {
      this._onSensorData(sensorData);
    });

    // ESP32-Fehler
    this.client.on("esp32_error", (error) => {
      this.emit("error", {
        type: "ESP32_ERROR",
        ...error,
        ts: Date.now()
      });
    });

    // Verbindungsfehler
    this.client.on("error", (err) => {
      this.emit("error", {
        type: "UART_ERROR",
        message: err.message,
        ts: Date.now()
      });
    });

    // Verbindung getrennt
    this.client.on("disconnected", () => {
      this.log("⚠️ UART connection lost");
      this.emit("disconnected");
    });

    // ACK / Status-Updates (optional für Debugging)
    this.client.on("ack", (ack) => {
      this.log(`✓ ACK from ESP32`);
    });
  }

  /**
   * Starte UART-Datenerfassung
   * @returns {Promise<void>}
   */
  async start() {
    if (this.isRunning) {
      this.log("⚠️ Already running");
      return;
    }

    try {
      this.log(`🚀 Starting UART Source on ${this.port}...`);
      await this.client.connect();
      this.isRunning = true;
      this.messageCount = 0;
      this.emit("started");
      this.log(`✅ UART Source started`);
    } catch (err) {
      this.log(`❌ Failed to start:`, err.message);
      this.emit("error", {
        type: "START_ERROR",
        message: err.message,
        ts: Date.now()
      });
      throw err;
    }
  }

  /**
   * Stoppe UART-Datenerfassung
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    try {
      this.log(`⏹️ Stopping UART Source...`);
      await this.client.disconnect();
      this.isRunning = false;
      this.emit("stopped");
      this.log(`✅ UART Source stopped`);
    } catch (err) {
      this.log(`⚠️ Error stopping:`, err.message);
    }
  }

  /**
   * Verarbeite empfangene Sensordaten
   * @private
   */
  _onSensorData(sensorData) {
    try {
      if (!this.isRunning) {
        return;
      }

      // Validiere Eingabedaten
      if (!sensorData || typeof sensorData !== "object") {
        this.log(`❌ Invalid sensorData: not an object`);
        this.emit("error", { type: "INVALID_SENSORDATA", message: "sensorData is not an object" });
        return;
      }

      // Validiere erforderliche Arrays
      if (!Array.isArray(sensorData.raw) || sensorData.raw.length !== 4) {
        this.log(`❌ Invalid sensorData.raw: expected array of length 4`);
        this.emit("error", { type: "INVALID_SENSORDATA", message: "invalid raw array" });
        return;
      }
      if (!Array.isArray(sensorData.filtered) || sensorData.filtered.length !== 4) {
        this.log(`❌ Invalid sensorData.filtered: expected array of length 4`);
        this.emit("error", { type: "INVALID_SENSORDATA", message: "invalid filtered array" });
        return;
      }

      // Rate-Limiting (wenn eingestellt)
      if (this.emitInterval > 0) {
        const now = Date.now();
        if (now - this.lastEmitTime < this.emitInterval) {
          return;
        }
        this.lastEmitTime = now;
      }

      this.messageCount++;

      // Normalisiere GEFILTERTE Werte für die Anzeige
      // Dies folgt dem ESP32 Algorithmus aus fsr_service.cpp
      const normalized = normalizeValues(sensorData.filtered);

      // Verwende vx/vy vom ESP32 direkt - diese sind bereits berechnet!
      // Der ESP32 berechnet diese mit seiner Normalisierung und Magnitude-Gewichtung
      const vx = sensorData.vx || 0;
      const vy = sensorData.vy || 0;

      // Standardisierte Ausgabe (kompatibel mit SensorProcessor)
      const data = {
        ts: sensorData.ts,
        source: "uart",
        // Rohwerte
        raw: {
          u: sensorData.raw[0],
          l: sensorData.raw[1],
          d: sensorData.raw[2],
          r: sensorData.raw[3]
        },
        // Gefilterte Werte (vom ESP32)
        filtered: {
          u: sensorData.filtered[0],
          l: sensorData.filtered[1],
          d: sensorData.filtered[2],
          r: sensorData.filtered[3]
        },
        // Normalisiert
        normalized: {
          u: normalized[0],
          l: normalized[1],
          d: normalized[2],
          r: normalized[3]
        },
        // Joystick-Vektor (vom ESP32 berechnet)
        vx: vx,
        vy: vy
      };

      // Berechne Update-Frequenz (Hz)
      const now = Date.now();
      const delta = now - this.lastFrameTime;
      this.lastFrameTime = now;
      
      if (delta > 0) {
        this.frameTimeDeltas.push(delta);
        if (this.frameTimeDeltas.length > 100) {
          this.frameTimeDeltas.shift(); // Keep last 100 deltas
        }
        
        const avgDelta = this.frameTimeDeltas.reduce((a, b) => a + b) / this.frameTimeDeltas.length;
        this.frequency = 1000 / avgDelta; // Convert ms to Hz
      }

      // Emittiere für SensorProcessor
      this.emit("data", data);
    } catch (err) {
      this.log(`❌ Sensor data processing error: ${err.message}`);
      this.emit("error", { 
        type: "SENSOR_PROCESS_ERROR", 
        message: err.message,
        stack: err.stack 
      });
    }
  }

  /**
   * Sende Kommando zum ESP32
   * @param {number} cmdId - Kommando ID
   * @param {Buffer} cmdData - Kommando-Daten (optional)
   * @returns {Promise<boolean>}
   */
  async sendCommand(cmdId, cmdData = Buffer.alloc(0)) {
    return this.client.sendCommand(cmdId, cmdData);
  }

  /**
   * Gibt Status aus
   * @returns {Object}
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      messageCount: this.messageCount,
      frequency: this.frequency.toFixed(2),
      clientStatus: this.client.getStatus()
    };
  }

  /**
   * Logging Helper
   * @private
   */
  log(...args) {
    if (this.logging) {
      console.log(`[UARTSource]`, ...args);
    }
  }
}

module.exports = { UARTSource };
