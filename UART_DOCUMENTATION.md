# 📡 UART INTEGRATION DOKUMENTATION

## 🎯 Überblick

**Vollständige Raspberry Pi ↔ ESP32 UART-Kommunikation** mit benutzerdefinertem Protokoll. Die Da-WebApp empfängt Sensor-Daten (FSR) vom ESP32 über serielle Schnittstelle und sendet sie an Web-Clients via WebSocket.

---

## 📁 Datei-Struktur

```
src/services/
├── uart/                      # UART-Kommunikations-Schicht
│   ├── uartFrameParser.js     # State-Machine für Frame-Parsing
│   ├── uartProtocol.js        # CRC8 Codec + Message-Dekodierung
│   ├── uartClient.js          # Serielle Port-Verwaltung
│   └── uartSource.js          # EventEmitter Wrapper → SensorProcessor
├── processing/
│   └── sensorProcessor.js     # Normalisierung + Vektor-Berechnung
└── simulation/
    └── simulationSource.js    # Demo-Datenquelle für Tests
```

---

## 🔌 Konfiguration

### Umgebungsvariablen (`.env`)

```bash
# UART aktivieren
UART_ENABLED=true

# Serieller Port (Raspberry Pi GPIO14/15)
UART_PORT=/dev/ttyAMA0          # oder /dev/ttyS0

# Baudrate (muss mit ESP32 matched sein)
UART_BAUD=115200

# Web-Server Port
PORT=3000
```

### Fallback-Logik

- **UART_ENABLED=true** + **UART_PORT vorhanden** → UARTSource
- **UART_ENABLED=false** oder **Port nicht erreichbar** → SimulationSource (Demo)

---

## 📡 UART-Protokoll Spezifikation

### Frame-Format

```
[Start:0xAA] [MsgType:1B] [PayloadLen:1B] [Payload:nB] [CRC8:1B] [Stop:0x55]
   1B           1B           1B            0-128B       1B         1B
```

### CRC8 Berechnung (Fletcher Checksum)

```javascript
csum1 = 0, csum2 = 0
for each byte in [MsgType | PayloadLen | Payload]:
    csum1 = (csum1 + byte) % 256
    csum2 = (csum2 + csum1) % 256
CRC8 = csum2
```

### Message Types

| Typ | Wert | Richtung | Inhalt |
|-----|------|----------|--------|
| **SensorData** | `0x01` | ESP32→RPi | FSR-Messwerte (17 bytes) |
| **Command** | `0x10` | RPi→ESP32 | Befehle (variable Länge) |
| **Ack** | `0x11` | ESP32→RPi | Bestätigung |
| **Error** | `0x12` | ESP32→RPi | Fehlerbenachrichtigung |
| **ConfigReq** | `0x13` | Bidirektional | Konfigurationsanfrage |
| **ConfigResp** | `0x14` | Bidirektional | Konfigurationsantwort |

### SensorData Payload (0x01) - 17 Bytes

```
[SensorID:1B] + [Sensor_0][Sensor_1][Sensor_2][Sensor_3]
                [filtered:2B|raw:2B]  × 4 Sensoren

Sensor-Mapping:
  raw[0] = Top/Up     (ADC4)
  raw[1] = Left       (ADC5)
  raw[2] = Down       (ADC6)
  raw[3] = Right      (ADC7)

Wertbereich: uint16 [0 ... 4095]
```

---

## 📊 Datenverarbeitungs-Pipeline

```
┌──────────────────────────────────────────────┐
│ UART Port (serialPort)                       │
│ /dev/ttyAMA0 @ 115200 baud                   │
└─────────────────┬──────────────────────────┘
                  │
                  ↓
┌──────────────────────────────────────────────┐
│ UARTFrameParser (State Machine)              │
│ - Byte-by-Byte Frame-Rekonstruktion         │
│ - Start/Stop Delimiter Detection             │
│ - Payload Length Validation                  │
└─────────────────┬──────────────────────────┘
                  │
                  ↓ (emits: "frame" event)
┌──────────────────────────────────────────────┐
│ UARTClient                                   │
│ - CRC8 Verifikation                         │
│ - Payload-Dekodierung nach MsgType          │
│ - Error Handling + Logging                   │
└─────────────────┬──────────────────────────┘
                  │
                  ↓ (emits: "sensordata" event)
┌──────────────────────────────────────────────┐
│ UARTSource (EventEmitter)                    │
│ - Normalisierung [0...4095] → [0.0...1.0]  │
│ - Vektor-Berechnung: vx, vy                 │
│ - Standardisierte Output-Format             │
└─────────────────┬──────────────────────────┘
                  │
                  ↓ (emits: "data" event)
┌──────────────────────────────────────────────┐
│ SensorProcessor                              │
│ - Output-Range-Skalierung (-100...+100)     │
│ - Deadzone-Handling (optional)              │
│ - Magnitude-Berechnung                      │
└─────────────────┬──────────────────────────┘
                  │
                  ↓ (processed data)
┌──────────────────────────────────────────────┐
│ Socket.IO                                    │
│ emit("joystick:update", processedData)      │
└─────────────────┬──────────────────────────┘
                  │
                  ↓
┌──────────────────────────────────────────────┐
│ Web-Browser Clients (WebSocket)              │
│ Echtzeit-Daten-Visualisierung                │
└──────────────────────────────────────────────┘
```

---

## 🚀 Verwendung

### Start mit UART

```bash
# In Da-WebApp Verzeichnis
export UART_ENABLED=true
export UART_PORT=/dev/ttyAMA0
export UART_BAUD=115200
export PORT=3000

npm start
# oder
node src/main.js
```

### Start mit Simulation (Demo)

```bash
export UART_ENABLED=false
npm start
```

### Output-Beispiel

```
[UARTSource] 🚀 Starting UART Source on /dev/ttyAMA0...
[UART] ✅ Connected to /dev/ttyAMA0 @ 115200 baud
📡 Using UART as data source: /dev/ttyAMA0 @ 115200 baud
✅ Data source started (UART)
🚀 Web server listening on http://localhost:3000

[UART] 📥 Frame received [MsgType=0x01] (17 bytes payload)
[UART] 📤 Sent frame [MsgType=0x11] (6 bytes)
```

---

## 📊 Socket.IO Events

### Server → Client

#### `joystick:update` (kontinuierlich)
```javascript
{
  ts: 1702345678123,              // Zeitstempel [ms]
  source: "uart",                 // "uart" oder "simulation"
  x: 45,                          // X-Achse [-100...+100]
  y: -60,                         // Y-Achse [-100...+100]
  magnitude: 0.7583,              // Vektor-Länge [0.0...√2]
  deadzone: false,                // In Deadzone?
  raw: {                          // Original ADC-Werte
    u: 2048,
    l: 1500,
    d: 3000,
    r: 2500
  }
}
```

#### `system:status` (bei Verbindungsänderung)
```javascript
{
  status: "connected",            // "connected" | "disconnected"
  source: "uart",
  sourceStats: {
    isConnected: true,
    port: "/dev/ttyAMA0",
    baudRate: 115200,
    messageReceivedCount: 1234,
    messageErrorCount: 2,
    errorRate: "0.0016"
  },
  ts: 1702345678123
}
```

#### `system:error` (bei Fehler)
```javascript
{
  type: "UART_ERROR" | "ESP32_ERROR" | "CRC_MISMATCH",
  message: "Port not found",
  ts: 1702345678123
}
```

### Client → Server

#### `request:status`
```javascript
socket.emit("request:status", {});
// Response: system:status event
```

---

## 🔧 API Reference

### UARTClient

```javascript
const { UARTClient } = require("./uart/uartClient");

const client = new UARTClient({
  port: "/dev/ttyAMA0",
  baudRate: 115200,
  logging: true
});

// Events
client.on("connected", () => {});
client.on("disconnected", () => {});
client.on("sensordata", (data) => {});
client.on("ack", (ack) => {});
client.on("esp32_error", (error) => {});
client.on("error", (err) => {});

// Methods
await client.connect();
await client.disconnect();
await client.sendMessage(msgType, payload);
await client.sendCommand(cmdId, cmdData);
await client.requestSensorData();

// Status
const status = client.getStatus();
// { isConnected, port, baudRate, messageReceivedCount, messageErrorCount, errorRate }
```

### UARTSource

```javascript
const { UARTSource } = require("./uart/uartSource");

const source = new UARTSource({
  port: "/dev/ttyAMA0",
  baudRate: 115200,
  logging: true
});

// Events
source.on("data", (data) => {});           // Normalisierte Sensordaten
source.on("error", (err) => {});
source.on("started", () => {});
source.on("stopped", () => {});
source.on("disconnected", () => {});

// Methods
await source.start();
await source.stop();
await source.sendCommand(cmdId, cmdData);

// Status
const status = source.getStatus();
// { isRunning, messageCount, clientStatus }
```

### SensorProcessor

```javascript
const { SensorProcessor } = require("./processing/sensorProcessor");

const processor = new SensorProcessor({
  outMin: -100,
  outMax: 100,
  deadzone: 0.05  // [0.0...1.0]
});

// Input-Format (von UARTSource)
const rawData = {
  ts: 1702345678123,
  source: "uart",
  raw: { u, l, d, r },
  filtered: { u, l, d, r },
  normalized: { u, l, d, r },
  vx: 0.5,
  vy: -0.3
};

// Process
const processed = processor.process(rawData);
// {
//   ts, source, x, y, magnitude, deadzone, raw
// }
```

---

## ⚠️ Fehlerbehandlung

### CRC-Fehler
```
[UART] ❌ CRC mismatch [MsgType=0x01]
```
→ Frame verworfen, kein Datenverlust (nächste Nachricht wird verarbeitet)

### Port nicht erreichbar
```
❌ Error opening port: ENOENT: no such file or directory
   Falling back to Simulation...
```
→ Fallback auf SimulationSource (wenn UART_ENABLED=true)

### Timeout bei Disconnect
```
📛 SIGINT received. Shutting down gracefully...
✓ HTTP server closed
✓ Data source stopped
✅ Server shutdown complete
```
→ 10 Sekunden Timeout vor erzwungenem Shutdown

---

## 🧪 Test/Debug

### Serien-Monitor (zum Anschauen)
```bash
# Mit tio
tio /dev/ttyAMA0

# Mit screen
screen /dev/ttyAMA0 115200

# Mit minicom
minicom -D /dev/ttyAMA0 -b 115200
```

### Manuelle Tests
```javascript
const { UARTClient } = require("./uart/uartClient");

async function test() {
  const client = new UARTClient({ port: "/dev/ttyAMA0" });
  
  client.on("sensordata", (data) => {
    console.log("Sensordaten:", data);
  });
  
  await client.connect();
  // ... warte auf Daten ...
  await client.disconnect();
}

test().catch(console.error);
```

---

## 📝 Raspberry Pi GPIO-Pins

**UART0 (GPIO14 TX, GPIO15 RX)**

```
RPi Serial TX (GPIO14) → ESP32 RX (Pin 18)
RPi Serial RX (GPIO15) ← ESP32 TX (Pin 17)
RPi GND → ESP32 GND
```

**Aktivierung auf RPi:**
```bash
# In raspi-config
$ sudo raspi-config
# Interface Options → Serial Port
# [Enable] Serial Port
# [Disable] Serial Console
# Reboot
```

**Überprüfung:**
```bash
$ dmesg | grep tty
# Sollte /dev/ttyAMA0 auflisten
```

---

## 🔄 Graceful Shutdown

Das System implementiert sauberes Herunterfahren bei:
- **SIGINT** (Ctrl+C)
- **SIGTERM** (systemd stop)

**Ablauf:**
1. HTTP Server wird geschlossen (neue Verbindungen abgelehnt)
2. UART-Connection wird geschlossen
3. Alle Datenströme werden beendet
4. Prozess endet mit Exit-Code 0

**Timeout:** 10 Sekunden (dann erzwungenes Shutdown)

---

## 🎨 Daten-Format-Beispiel

### Rohwerte vom ESP32
```
Frame: [0xAA][0x01][0x11][...17 Bytes Payload...][CRC8][0x55]

Payload (SensorData):
  SensorID: 0x00
  filtered[0] (Top):    0x08FF (2303)
  raw[0]:               0x0900 (2304)
  filtered[1] (Left):   0x0A00 (2560)
  raw[1]:               0x0B00 (2816)
  filtered[2] (Down):   0x0C00 (3072)
  raw[2]:               0x0D00 (3328)
  filtered[3] (Right):  0x0E00 (3584)
  raw[3]:               0x0F00 (3840)
```

### Nach Verarbeitung
```javascript
{
  ts: 1702345678123,
  source: "uart",
  x: 23,          // Right bias
  y: -45,         // Down bias
  magnitude: 0.5,
  deadzone: false,
  raw: {
    u: 2304,
    l: 2816,
    d: 3072,
    r: 3584
  }
}
```

---

## 📚 Referenzen

- **ESP32 Protokoll:** `src/drivers/uart_protocol.h` (C-Header)
- **FSR-Service:** `src/services/fsr_service.h` (Filter + Normalisierung)
- **serialport npm:** https://serialport.io/

---

**Status:** ✅ Vollständig implementiert und dokumentiert  
**Letzte Änderung:** 2026-02-18  
**Version:** 1.0.0
