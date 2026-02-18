/**
 * @file uartProtocol.js
 * @brief UART-Protokoll Codec mit CRC8 (Fletcher Checksumme)
 * 
 * Verantwortlichkeit:
 *  - CRC8 Berechnung und Verifikation
 *  - Frame-Encoding (Message → Bytes)
 *  - Frame-Decoding (Bytes → Message)
 *  - SensorData-Payload-Parsing
 */

const FRAME_CONST = {
  START: 0xAA,
  STOP: 0x55
};

const MSG_TYPE = {
  SENSORDATA: 0x01,
  COMMAND: 0x10,
  ACK: 0x11,
  ERROR: 0x12,
  CONFIG_REQ: 0x13,
  CONFIG_RESP: 0x14
};

/**
 * Berechne Fletcher CRC8 über Datenpuffer
 * 
 * Algorithmus:
 *   csum1 = 0, csum2 = 0
 *   for byte in data:
 *       csum1 = (csum1 + byte) % 256
 *       csum2 = (csum2 + csum1) % 256
 *   return csum2
 * 
 * @param {Buffer} data - Datenpuffer [MsgType | PayloadLen | Payload]
 * @returns {number} CRC8-Wert [0x00...0xFF]
 */
function calculateCRC8(data) {
  let csum1 = 0;
  let csum2 = 0;

  for (let i = 0; i < data.length; i++) {
    csum1 = (csum1 + data[i]) % 256;
    csum2 = (csum2 + csum1) % 256;
  }

  return csum2;
}

/**
 * Verifiziere Frame-Checksumme (Fletcher CRC8)
 * 
 * WICHTIG: Berechnet CRC korrekt über die komplette Bytesequenz!
 * [MsgType|PayloadLen|Payload] als eine Sequenz
 * 
 * @param {number} msgType - Nachrichtentyp
 * @param {number} payloadLen - Payload-Länge
 * @param {Buffer} payload - Payload-Daten
 * @param {number} receivedCRC - Empfangene CRC
 * @returns {boolean} true wenn Checksummen übereinstimmen
 */
function verifyCRC8(msgType, payloadLen, payload, receivedCRC) {
  // Berechne CRC über [MsgType | PayloadLen | Payload] als komplette Sequenz
  // Das ist die korrekte Fletcher CRC8-Berechnung!
  
  let csum1 = 0;
  let csum2 = 0;

  // Byte 1: MsgType
  csum1 = (csum1 + msgType) % 256;
  csum2 = (csum2 + csum1) % 256;

  // Byte 2: PayloadLen
  csum1 = (csum1 + payloadLen) % 256;
  csum2 = (csum2 + csum1) % 256;

  // Bytes 3+: Payload
  if (payloadLen > 0 && payload && payload.length > 0) {
    for (let i = 0; i < payloadLen && i < payload.length; i++) {
      csum1 = (csum1 + payload[i]) % 256;
      csum2 = (csum2 + csum1) % 256;
    }
  }

  const calculatedCRC = csum2;
  return calculatedCRC === receivedCRC;
}

/**
 * Kodiere Frame aus Komponenten
 * 
 * @param {number} msgType - Nachrichtentyp
 * @param {Buffer} payload - Payload-Daten (optional)
 * @returns {Buffer} Kompletter Frame [Start|MsgType|PayloadLen|Payload|CRC8|Stop]
 */
function encodeFrame(msgType, payload = Buffer.alloc(0)) {
  const payloadLen = payload.length;
  
  // Berechne CRC über [MsgType | PayloadLen | Payload]
  const header = Buffer.allocUnsafe(2);
  header[0] = msgType;
  header[1] = payloadLen;

  const data = Buffer.concat([header, payload]);
  const crc8 = calculateCRC8(data);

  // Konstruiere kompletten Frame
  const frame = Buffer.allocUnsafe(6 + payloadLen);
  frame[0] = FRAME_CONST.START;
  frame[1] = msgType;
  frame[2] = payloadLen;
  
  if (payloadLen > 0) {
    payload.copy(frame, 3);
  }
  
  frame[3 + payloadLen] = crc8;
  frame[4 + payloadLen] = FRAME_CONST.STOP;

  return frame;
}

/**
 * Dekodiere SensorData-Payload (0x01)
 * 
 * Format (24 Bytes, BIG-ENDIAN):
 *   [raw[0-3]:2B each (8B)] [filtered[0-3]:2B each (8B)] [vx:4B float] [vy:4B float]
 * 
 * Layout:
 *   Bytes 0-1:   raw[0] (Big-Endian uint16)
 *   Bytes 2-3:   raw[1] (Big-Endian uint16)
 *   Bytes 4-5:   raw[2] (Big-Endian uint16)
 *   Bytes 6-7:   raw[3] (Big-Endian uint16)
 *   Bytes 8-9:   filtered[0] (Big-Endian uint16)
 *   Bytes 10-11: filtered[1] (Big-Endian uint16)
 *   Bytes 12-13: filtered[2] (Big-Endian uint16)
 *   Bytes 14-15: filtered[3] (Big-Endian uint16)
 *   Bytes 16-19: vx (IEEE 754 float, Big-Endian)
 *   Bytes 20-23: vy (IEEE 754 float, Big-Endian)
 * 
 * @param {Buffer} payload - Payload-Buffer (24 bytes)
 * @returns {Object|null} 
 *   {
 *     raw: [u16, u16, u16, u16],
 *     filtered: [u16, u16, u16, u16],
 *     vx: number,
 *     vy: number,
 *     ts: number  // Zeitstempel hinzugefügt
 *   }
 */
function decodeSensorData(payload) {
  // Überprüfe Payload-Größe (muss exakt 24 Bytes sein)
  if (payload.length < 24) {
    return null; // Invalid payload size
  }

  const raw = [];
  const filtered = [];
  
  // Lese raw[4] - Big-Endian (Bytes 0-7)
  for (let i = 0; i < 4; i++) {
    const offset = i * 2;
    raw[i] = payload.readUInt16BE(offset);
  }
  
  // Lese filtered[4] - Big-Endian (Bytes 8-15)
  for (let i = 0; i < 4; i++) {
    const offset = 8 + i * 2;
    filtered[i] = payload.readUInt16BE(offset);
  }
  
  // Lese vx - Big-Endian float (Bytes 16-19)
  const vx = payload.readFloatBE(16);
  
  // Lese vy - Big-Endian float (Bytes 20-23)
  const vy = payload.readFloatBE(20);

  return {
    raw: raw,           // [u/top, l/left, d/down, r/right]
    filtered: filtered, // [u/top, l/left, d/down, r/right]
    vx: vx,             // Vektor X (-1...+1)
    vy: vy,             // Vektor Y (-1...+1)
    ts: Date.now()
  };
}

/**
 * Enkodiere SensorData-Payload
 * 
 * @param {number} sensorId - Sensor ID
 * @param {Array<number>} filtered - Array von 4 gefilterten Werten
 * @param {Array<number>} raw - Array von 4 Rohwerten
 * @returns {Buffer} Payload-Buffer (17 bytes)
 */
function encodeSensorData(sensorId, filtered, raw) {
  const payload = Buffer.allocUnsafe(17);
  payload[0] = sensorId;

  for (let i = 0; i < 4; i++) {
    const offset = 1 + i * 4;
    payload.writeUInt16LE(filtered[i], offset);
    payload.writeUInt16LE(raw[i], offset + 2);
  }

  return payload;
}

/**
 * Dekodiere Command-Payload (0x10)
 * Format: [CmdID:1B][CmdData...:nB]
 * 
 * @param {Buffer} payload - Payload-Buffer
 * @returns {Object}
 *   { cmdId: number, cmdData: Buffer }
 */
function decodeCommand(payload) {
  if (payload.length < 1) {
    return null;
  }

  return {
    cmdId: payload[0],
    cmdData: payload.slice(1)
  };
}

module.exports = {
  MSG_TYPE,
  FRAME_CONST,
  calculateCRC8,
  verifyCRC8,
  encodeFrame,
  decodeSensorData,
  encodeSensorData,
  decodeCommand
};
