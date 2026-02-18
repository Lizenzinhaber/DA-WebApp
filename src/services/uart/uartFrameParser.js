/**
 * @file uartFrameParser.js
 * @brief State Machine für UART-Frame Parsing
 * 
 * Zustandsübergänge:
 *   WAIT_START → (find 0xAA) → READ_HEADER → READ_PAYLOAD → READ_CRC → READ_STOP → COMPLETE
 * 
 * Frame-Format: [0xAA][MsgType][PayloadLen][Payload...][CRC8][0x55]
 */

const { EventEmitter } = require("events");

const FRAME_STATE = {
  WAIT_START: "WAIT_START",
  READ_HEADER: "READ_HEADER",
  READ_PAYLOAD: "READ_PAYLOAD",
  READ_CRC: "READ_CRC",
  READ_STOP: "READ_STOP",
  COMPLETE: "COMPLETE"
};

const FRAME_CONST = {
  START: 0xAA,
  STOP: 0x55,
  MAX_PAYLOAD: 128
};

class UARTFrameParser extends EventEmitter {
  constructor() {
    super();
    this.reset();
  }

  reset() {
    this.state = FRAME_STATE.WAIT_START;
    this.msgType = 0;
    this.payloadLen = 0;
    this.payload = Buffer.alloc(0);
    this.crc8 = 0;
    this.bytesRead = 0;
  }

  /**
   * Parse Bytes aus dem seriellen Port
   * @param {Buffer} data - Eingangsdaten
   */
  parse(data) {
    for (let i = 0; i < data.length; i++) {
      const byte = data[i];

      switch (this.state) {
        case FRAME_STATE.WAIT_START:
          if (byte === FRAME_CONST.START) {
            this.reset();
            this.state = FRAME_STATE.READ_HEADER;
          }
          break;

        case FRAME_STATE.READ_HEADER:
          if (this.bytesRead === 0) {
            this.msgType = byte;
            this.bytesRead++;
          } else {
            this.payloadLen = byte;

            if (this.payloadLen > FRAME_CONST.MAX_PAYLOAD) {
              // Ungültige Payload-Länge: zurücksetzen
              this.state = FRAME_STATE.WAIT_START;
              this.bytesRead = 0;
            } else if (this.payloadLen === 0) {
              // Keine Payload: direkt zur CRC
              this.state = FRAME_STATE.READ_CRC;
              this.bytesRead = 0;
              this.payload = Buffer.alloc(0);
            } else {
              // Payload vorhanden: lesen
              this.state = FRAME_STATE.READ_PAYLOAD;
              this.bytesRead = 0;
              this.payload = Buffer.alloc(this.payloadLen);
            }
          }
          break;

        case FRAME_STATE.READ_PAYLOAD:
          this.payload[this.bytesRead] = byte;
          this.bytesRead++;

          if (this.bytesRead === this.payloadLen) {
            this.state = FRAME_STATE.READ_CRC;
            this.bytesRead = 0;
          }
          break;

        case FRAME_STATE.READ_CRC:
          this.crc8 = byte;
          this.state = FRAME_STATE.READ_STOP;
          break;

        case FRAME_STATE.READ_STOP:
          if (byte === FRAME_CONST.STOP) {
            // Frame komplett und gültig
            this.emit("frame", {
              msgType: this.msgType,
              payloadLen: this.payloadLen,
              payload: this.payload,
              crc8: this.crc8
            });
          }
          // Zurücksetzen (egal ob Stop korrekt war)
          this.state = FRAME_STATE.WAIT_START;
          this.reset();
          break;
      }
    }
  }
}

module.exports = { UARTFrameParser };
