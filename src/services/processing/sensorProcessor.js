// src/services/processing/sensorProcessor.js

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Verarbeitet 4 FSR-Rohwerte (0..4095) zu Joystick (x,y).
 *
 * Typisches Mapping:
 *   x_diff = fsr2 - fsr4
 *   y_diff = fsr1 - fsr3
 *
 * Normierung:
 *   diff in [-4095..4095] -> Output in [-100..100]
 */
class SensorProcessor {
  constructor({
    adcMin = 0,
    adcMax = 4095,
    outMin = -100,
    outMax = 100
  } = {}) {
    this.adcMin = adcMin;
    this.adcMax = adcMax;
    this.outMin = outMin;
    this.outMax = outMax;

    this.maxDiff = adcMax - adcMin; // 4095
  }

  process({ fsr1, fsr2, fsr3, fsr4 }) {
    const xDiff = fsr2 - fsr4;
    const yDiff = fsr1 - fsr3;

    const x = clamp(Math.round((xDiff / this.maxDiff) * this.outMax), this.outMin, this.outMax);
    const y = clamp(Math.round((yDiff / this.maxDiff) * this.outMax), this.outMin, this.outMax);

    return {
      x,
      y,
      raw: { fsr1, fsr2, fsr3, fsr4 }
    };
  }
}

module.exports = { SensorProcessor };
