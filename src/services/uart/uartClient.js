/**
 * @file uartClient.js
 * @brief UART-Kommunikation Verwaltung mit Event-Emitter
 * 
 * Verantwortlichkeit:
 *  - Serielle Port-Verwaltung (Open/Close)
 *  - Frame Parser Koordination
 *  - CRC-Verifikation
 *  - Fehlerbehandlung und Logging
 *  - Event-getriebene Kommunikation (keine Polling)
 */

const { EventEmitter } = require("events");
const { SerialPort } = require("serialport");
const { UARTFrameParser } = require("./uartFrameParser");
const {
  MSG_TYPE,
  verifyCRC8,
  encodeFrame,
  decodeSensorData,
  decodeCommand
} = require("./uartProtocol");

const DEFAULT_PORT = process.env.UART_PORT || "/dev/ttyAMA0";
const DEFAULT_BAUDRATE = parseInt(process.env.UART_BAUD || "115200");

class UARTClient extends EventEmitter {
  constructor({ port = DEFAULT_PORT, baudRate = DEFAULT_BAUDRATE, logging = true } = {}) {
    super();
    
    this.port = port;
    this.baudRate = baudRate;
    this.logging = logging;
    
    this.serialPort = null;
    this.frameParser = new UARTFrameParser();
    this.isConnected = false;
    this.messageReceivedCount = 0;
    this.messageErrorCount = 0;
  }

  /**
   * Verbinde mit dem seriellen Port
   * @returns {Promise<void>}
   */
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        this.serialPort = new SerialPort(
          {
            path: this.port,
            baudRate: this.baudRate,
            autoOpen: false
          },
          (err) => {
            if (err) {
              this.log(`❌ Error opening port ${this.port}:`, err.message);
              reject(err);
            }
          }
        );

        // Data Event: empfangene Bytes vom seriellen Port
        this.serialPort.on("data", (data) => {
          this.frameParser.parse(data);
        });

        // Frame Event: kompletter Frame geparst
        this.frameParser.on("frame", (frame) => {
          this._onFrameReceived(frame);
        });

        // Error Event vom seriellen Port
        this.serialPort.on("error", (err) => {
          this.log(`⚠️ Serial port error:`, err.message);
          this.emit("error", err);
        });

        // Close Event
        this.serialPort.on("close", () => {
          this.isConnected = false;
          this.log("🔌 Serial port closed");
          this.emit("disconnected");
        });

        // Öffne Port
        this.serialPort.open((err) => {
          if (err) {
            this.log(`❌ Error opening port:`, err.message);
            reject(err);
          } else {
            this.isConnected = true;
            this.log(`✅ Connected to ${this.port} @ ${this.baudRate} baud`);
            this.emit("connected");
            resolve();
          }
        });
      } catch (err) {
        this.log(`❌ Connection error:`, err.message);
        reject(err);
      }
    });
  }

  /**
   * Trenne vom seriellen Port
   * @returns {Promise<void>}
   */
  async disconnect() {
    return new Promise((resolve) => {
      if (!this.serialPort) {
        resolve();
        return;
      }

      if (this.isConnected) {
        this.serialPort.close((err) => {
          if (err) {
            this.log(`⚠️ Error closing port:`, err.message);
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Sende Frame mit automatischer CRC-Berechnung
   * @param {number} msgType - Nachrichtentyp
   * @param {Buffer} payload - Payload (optional)
   * @returns {Promise<boolean>} true wenn erfolgreich gesendet
   */
  async sendMessage(msgType, payload = Buffer.alloc(0)) {
    if (!this.isConnected) {
      this.log(`❌ Not connected, cannot send message`);
      return false;
    }

    try {
      const frame = encodeFrame(msgType, payload);
      
      return new Promise((resolve) => {
        this.serialPort.write(frame, (err) => {
          if (err) {
            this.log(`❌ Write error:`, err.message);
            resolve(false);
          } else {
            this.log(`📤 Sent frame [MsgType=0x${msgType.toString(16).padStart(2, "0")}] (${frame.length} bytes)`);
            resolve(true);
          }
        });
      });
    } catch (err) {
      this.log(`❌ Send error:`, err.message);
      return false;
    }
  }

  /**
   * Sende SensorData Request (nur bei Bedarf)
   * @returns {Promise<boolean>}
   */
  async requestSensorData() {
    return this.sendMessage(MSG_TYPE.CONFIG_REQ, Buffer.alloc(0));
  }

  /**
   * Sende Kommando zum ESP32
   * @param {number} cmdId - Kommando ID
   * @param {Buffer} cmdData - Kommando-Daten (optional)
   * @returns {Promise<boolean>}
   */
  async sendCommand(cmdId, cmdData = Buffer.alloc(0)) {
    const payload = Buffer.allocUnsafe(1 + cmdData.length);
    payload[0] = cmdId;
    if (cmdData.length > 0) {
      cmdData.copy(payload, 1);
    }
    
    return this.sendMessage(MSG_TYPE.COMMAND, payload);
  }

  /**
   * Sende Password Data (0x41) zum ESP32
   * Payload: [length:1B][password:16B] = 17 Bytes
   * @param {string} password - 16-stelliges alphanumerisches Passwort
   * @returns {Promise<boolean>}
   */
  async sendPasswordData(password) {
    if (!password || password.length !== 16) {
      this.log(`❌ Invalid password length: ${password ? password.length : 0} (need 16)`);
      return false;
    }
    // Payload: [0x10 (length=16)] + [16 Bytes password]
    const payload = Buffer.allocUnsafe(17);
    payload[0] = 0x10;  // Length prefix = 16
    payload.write(password, 1, 16, 'ascii');
    return this.sendMessage(MSG_TYPE.PASSWORD_DATA, payload);
  }

  /**
   * Sende AP Status (0x43) zum ESP32
   * Payload: [clientCount:1B][remainingSec:2B BE][flags:1B] = 4 Bytes
   * 
   * Flags:
   *   0x01 = AP aktiv
   *   0x02 = Idle-Shutdown Timer bewaffnet
   *   0x04 = Shutdown steht unmittelbar bevor
   * 
   * @param {number} clientCount - Anzahl verbundener WLAN-Clients (0-255)
   * @param {number} remainingSec - Verbleibende Sekunden bis Shutdown (0 = nicht aktiv)
   * @param {number} flags - Bit-Flags
   * @returns {Promise<boolean>}
   */
  async sendAPStatus(clientCount, remainingSec, flags) {
    const payload = Buffer.alloc(4);
    payload[0] = clientCount & 0xFF;
    payload.writeUInt16BE(remainingSec & 0xFFFF, 1);
    payload[3] = flags & 0xFF;
    return this.sendMessage(MSG_TYPE.AP_STATUS, payload);
  }

  /**
   * Behandle empfangene Frame
   * @private
   */
  _onFrameReceived(frame) {
    try {
      // Verifiziere CRC
      if (!verifyCRC8(frame.msgType, frame.payloadLen, frame.payload, frame.crc8)) {
        this.messageErrorCount++;
        this.log(
          `❌ CRC mismatch [MsgType=0x${frame.msgType.toString(16).padStart(2, "0")}]`
        );
        this.emit("error", { type: "CRC_MISMATCH", frame });
        return;
      }

      this.messageReceivedCount++;
      this.log(
        `📥 Frame received [MsgType=0x${frame.msgType.toString(16).padStart(2, "0")}] (${frame.payloadLen} bytes payload)`
      );

      // Dekodiere je nach Message Type
      switch (frame.msgType) {
        case MSG_TYPE.SENSORDATA: {
          const sensorData = decodeSensorData(frame.payload);
          if (sensorData) {
            this.emit("sensordata", sensorData);
          } else {
            this.log(`❌ Invalid SensorData payload length: ${frame.payloadLen}`);
            this.messageErrorCount++;
          }
          break;
        }

        case MSG_TYPE.ACK: {
          this.emit("ack", { originalMsgType: frame.payload[0] });
          break;
        }

        case MSG_TYPE.ERROR: {
          const errorCode = frame.payload[0] || 0;
          const errorDetails = frame.payload[1] || 0;
          this.log(`⚠️ ESP32 Error [Code=0x${errorCode.toString(16)}, Details=0x${errorDetails.toString(16)}]`);
          this.emit("esp32_error", { errorCode, errorDetails });
          break;
        }

        case MSG_TYPE.CONFIG_RESP: {
          this.log(`✓ Config Response received`);
          this.emit("config_resp", { payload: frame.payload });
          break;
        }

        case MSG_TYPE.PASSWORD_REQ: {
          this.log(`📥 Password Request (0x40) from ESP32`);
          this.emit("password_req");
          break;
        }

        case MSG_TYPE.PASSWORD_ACK: {
          const status = frame.payload.length > 0 ? frame.payload[0] : 0;
          this.log(`✓ Password ACK (0x42) from ESP32 – Status: ${status === 1 ? 'SUCCESS' : 'FAIL'}`);
          this.emit("password_ack", { status });
          break;
        }

        default:
          this.log(`⚠️ Unknown message type: 0x${frame.msgType.toString(16).padStart(2, "0")}`);
      }
    } catch (err) {
      this.messageErrorCount++;
      this.log(`❌ Frame processing error: ${err.message}`);
      this.emit("error", { type: "FRAME_PROCESS_ERROR", message: err.message });
    }
  }

  /**
   * Logging Helper
   * @private
   */
  log(...args) {
    if (this.logging) {
      console.log(`[UART]`, ...args);
    }
  }

  /**
   * Gibt Verbindungsstatus aus
   * @returns {Object}
   */
  getStatus() {
    return {
      isConnected: this.isConnected,
      port: this.port,
      baudRate: this.baudRate,
      messageReceivedCount: this.messageReceivedCount,
      messageErrorCount: this.messageErrorCount,
      errorRate:
        this.messageReceivedCount === 0
          ? 0
          : (this.messageErrorCount / (this.messageReceivedCount + this.messageErrorCount)).toFixed(4)
    };
  }
}

module.exports = { UARTClient };
