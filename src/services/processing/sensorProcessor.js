/**
 * @file sensorProcessor.js
 * @brief Sensor-Datenverarbeitung: Normalisierung, Vektorberechnung, Skalierung
 * 
 * Verantwortlichkeit:
 *  - Normalisierung von Sensor-Rohwerten
 *  - Joystick-Vektor-Berechnung
 *  - Ausgabe-Range-Skalierung (z.B. -100...+100 für UI)
 *  - Filtering/Glättung (optional)
 */

/**
 * SensorProcessor: Transformiert Sensor-Rohwerte zu Ausgabe-Format
 */
class SensorProcessor {
  /**
   * @param {Object} options - Konfiguration
   * @param {number} options.outMin - Minimale Ausgabe (z.B. -100)
   * @param {number} options.outMax - Maximale Ausgabe (z.B. 100)
   * @param {number} options.deadzone - Deadzone [0.0...1.0] (default: 0.0)
   */
  constructor({ outMin = -100, outMax = 100, deadzone = 0.0 } = {}) {
    this.outMin = outMin;
    this.outMax = outMax;
    this.deadzone = Math.max(0, Math.min(1, deadzone));
    this.range = outMax - outMin;
  }

  /**
   * Verarbeite Sensor-Daten
   * 
   * Input: {
   *   ts: number,
   *   source: string,
   *   raw/filtered/normalized: { u, l, d, r },
   *   vx, vy: number
   * }
   * 
   * Output: {
   *   ts: number,
   *   source: string,
   *   x: number,           // skaliert auf [outMin...outMax]
   *   y: number,           // skaliert auf [outMin...outMax]
   *   magnitude: number,   // ||[x,y]||
   *   deadzone: boolean,   // true wenn in Deadzone
   *   raw: { u, l, d, r }, // Original Rohwerte
   * }
   * 
   * @param {Object} rawData - Sensor-Daten von UARTSource/SimulationSource
   * @returns {Object} Verarbeitete Daten
   */
  process(rawData) {
    // Extrahiere Vektor (vx, vy schon normalisiert auf [-1.0...+1.0] von UARTSource)
    let vx = rawData.vx || 0;
    let vy = rawData.vy || 0;

    // Berechne Magnitude (Länge des Vektors)
    const magnitude = Math.sqrt(vx * vx + vy * vy);

    // Deadzone anwenden
    let isInDeadzone = false;
    if (magnitude < this.deadzone) {
      vx = 0;
      vy = 0;
      isInDeadzone = true;
    }

    // Skaliere auf Ausgabe-Range
    // vx, vy sind im Bereich [-1.0...+1.0]
    // Skaliere zu [outMin...outMax]
    const x = vx * (this.range / 2) + (this.outMin + this.outMax) / 2;
    const y = vy * (this.range / 2) + (this.outMin + this.outMax) / 2;

    return {
      ts: rawData.ts || Date.now(),
      source: rawData.source || "unknown",
      x: Math.round(x),
      y: Math.round(y),
      magnitude: parseFloat(magnitude.toFixed(4)),
      deadzone: isInDeadzone,
      raw: rawData.raw || { u: 0, l: 0, d: 0, r: 0 }
    };
  }

  /**
   * Batch-Verarbeitung (für Test-Szenarien)
   * @param {Array<Object>} dataArray - Array von Sensor-Daten
   * @returns {Array<Object>} Array von verarbeiteten Daten
   */
  processBatch(dataArray) {
    return dataArray.map((data) => this.process(data));
  }
}

module.exports = { SensorProcessor };
