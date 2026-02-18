/**
 * @file example-uart-test.js
 * @brief Beispiele für UART-Komponenten Nutzung
 * 
 * HINWEIS: Dies ist ein Referenz-Dokument
 * Copy-Paste relevantem Code in deine Tests
 */

// ============================================================================
// EXAMPLE 1: Einfacher UARTClient Test
// ============================================================================

async function example_basicUARTClient() {
  const { UARTClient } = require("./src/services/uart");

  const client = new UARTClient({
    port: "/dev/ttyAMA0",
    baudRate: 115200,
    logging: true
  });

  // Event-Listener registrieren
  client.on("sensordata", (data) => {
    console.log("📊 Sensor-Daten:", {
      filtered: data.filtered,
      raw: data.raw,
      ts: data.ts
    });
  });

  client.on("ack", (ack) => {
    console.log("✓ ACK received:", ack);
  });

  client.on("error", (err) => {
    console.error("❌ Error:", err);
  });

  try {
    // Verbinde
    await client.connect();
    console.log("✅ Connected!");

    // Warte auf Daten (30 Sekunden)
    await new Promise((resolve) => setTimeout(resolve, 30000));

    // Trenne
    await client.disconnect();
    console.log("✓ Disconnected");

    // Gib Status aus
    console.log("Status:", client.getStatus());
  } catch (err) {
    console.error("Fatal error:", err.message);
  }
}

// ============================================================================
// EXAMPLE 2: UARTSource mit Pipeline
// ============================================================================

async function example_uartSourcePipeline() {
  const { UARTSource } = require("./src/services/uart");
  const { SensorProcessor } = require("./src/services/processing/sensorProcessor");

  // Komponenten erstellen
  const source = new UARTSource({
    port: "/dev/ttyAMA0",
    baudRate: 115200,
    logging: true
  });

  const processor = new SensorProcessor({
    outMin: -100,
    outMax: 100,
    deadzone: 0.05
  });

  // Output-Statistik
  let messageCount = 0;
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  // Data-Pipeline
  source.on("data", (rawData) => {
    const processed = processor.process(rawData);

    messageCount++;

    // Statistik sammeln
    minX = Math.min(minX, processed.x);
    maxX = Math.max(maxX, processed.x);
    minY = Math.min(minY, processed.y);
    maxY = Math.max(maxY, processed.y);

    // Output
    if (messageCount % 10 === 0) {
      console.log(`[${messageCount}] X=${processed.x.toString().padStart(4)} Y=${processed.y.toString().padStart(4)} Mag=${processed.magnitude.toFixed(3)}`);
    }
  });

  // Error-Handling
  source.on("error", (err) => {
    console.error("❌ Source error:", err.type, err.message);
  });

  // Status-Updates
  source.on("started", () => {
    console.log("✅ Source started");
  });

  source.on("stopped", () => {
    console.log("⏹️ Source stopped");
    console.log(`\n📊 Statistics (${messageCount} messages):`);
    console.log(`  X range: [${minX}, ${maxX}]`);
    console.log(`  Y range: [${minY}, ${maxY}]`);
  });

  try {
    // Starte
    await source.start();

    // Laufe für 60 Sekunden
    await new Promise((resolve) => setTimeout(resolve, 60000));

    // Stoppe
    await source.stop();
  } catch (err) {
    console.error("Fatal error:", err.message);
  }
}

// ============================================================================
// EXAMPLE 3: Programmgesteuerter UART-Befehl
// ============================================================================

async function example_sendCommand() {
  const { UARTClient } = require("./src/services/uart");

  const client = new UARTClient({
    port: "/dev/ttyAMA0",
    baudRate: 115200
  });

  client.on("ack", (ack) => {
    console.log("✓ Command acknowledged!");
  });

  client.on("error", (err) => {
    console.error("❌ Error:", err);
  });

  try {
    await client.connect();

    // Beispiel: Sende einen Reset-Befehl (0x11)
    const cmdId = 0x11;  // RESET
    const success = await client.sendCommand(cmdId);

    if (success) {
      console.log("✓ Command sent");
    } else {
      console.log("❌ Command failed to send");
    }

    await client.disconnect();
  } catch (err) {
    console.error("Fatal error:", err.message);
  }
}

// ============================================================================
// EXAMPLE 4: Simulation vs UART Toggle
// ============================================================================

async function example_dataSourceToggle() {
  const { UARTSource } = require("./src/services/uart");
  const { SimulationSource } = require("./src/services/simulation/simulationSource");

  // Wähle Quelle basierend auf Umgebung
  let source;

  const useUART = process.env.USE_UART === "true";

  if (useUART) {
    console.log("🔌 Using UARTSource");
    source = new UARTSource({
      port: process.env.UART_PORT || "/dev/ttyAMA0",
      baudRate: parseInt(process.env.UART_BAUD || "115200"),
      logging: true
    });
  } else {
    console.log("🎬 Using SimulationSource");
    source = new SimulationSource({
      hz: 50,
      radius: 80,
      periodMs: 4000
    });
  }

  // Beide Quellen haben die gleiche API!
  let count = 0;
  source.on("data", (data) => {
    count++;
    if (count % 25 === 0) {
      console.log(`[${count}] ${data.source}: x=${Math.round(data.vx * 100)}, y=${Math.round(data.vy * 100)}`);
    }
  });

  try {
    await source.start();
    await new Promise((resolve) => setTimeout(resolve, 30000));
    await source.stop();
    console.log(`✓ Processed ${count} messages`);
  } catch (err) {
    console.error("Fatal error:", err.message);
  }
}

// ============================================================================
// EXAMPLE 5: CRC Verification Test
// ============================================================================

function example_crcVerification() {
  const {
    calculateCRC8,
    verifyCRC8,
    encodeFrame,
    decodeSensorData,
    encodeSensorData
  } = require("./src/services/uart/uartProtocol");

  console.log("🧪 CRC Verification Test\n");

  // Erzeuge Test-Daten
  const sensorId = 0x00;
  const filtered = [1000, 1500, 2000, 2500];
  const raw = [1010, 1510, 2010, 2510];

  // Enkodiere Payload
  const payload = encodeSensorData(sensorId, filtered, raw);
  console.log(`✓ Encoded payload (${payload.length} bytes)`);

  // Dekodiere zurück
  const decoded = decodeSensorData(payload);
  console.log(`✓ Decoded payload:`);
  console.log(`  Filtered: [${decoded.filtered.join(", ")}]`);
  console.log(`  Raw:      [${decoded.raw.join(", ")}]`);

  // Erzeuge kompletten Frame
  const msgType = 0x01;  // SensorData
  const frame = encodeFrame(msgType, payload);
  console.log(`✓ Generated frame (${frame.length} bytes)`);
  console.log(`  Hex: ${frame.toString("hex").toUpperCase()}`);

  // Verifiziere CRC
  const crcOk = verifyCRC8(
    msgType,
    payload.length,
    payload,
    frame[frame.length - 2]  // CRC-Byte
  );
  console.log(`✓ CRC verification: ${crcOk ? "✅ OK" : "❌ FAILED"}`);
}

// ============================================================================
// EXAMPLE 6: Integration in Express Server
// ============================================================================

async function example_expressIntegration() {
  const express = require("express");
  const http = require("http");
  const { Server } = require("socket.io");
  const { UARTSource } = require("./src/services/uart");
  const { SensorProcessor } = require("./src/services/processing/sensorProcessor");

  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer);

  // UART-Komponenten
  const source = new UARTSource({ port: "/dev/ttyAMA0" });
  const processor = new SensorProcessor({ outMin: -100, outMax: 100 });

  // Data-Pipeline
  source.on("data", (raw) => {
    const processed = processor.process(raw);
    io.emit("joystick:update", processed);
  });

  // WebSocket
  io.on("connection", (socket) => {
    console.log("Client connected");
    socket.emit("server:hello", { msg: "welcome" });
  });

  // Start
  httpServer.listen(3000, async () => {
    await source.start();
    console.log("✅ Server started on port 3000");
  });

  // Shutdown
  process.on("SIGINT", async () => {
    console.log("Shutting down...");
    await source.stop();
    httpServer.close();
    process.exit(0);
  });
}

// ============================================================================
// EXAMPLE 7: Fehlerbehandlung und Fallback
// ============================================================================

async function example_errorHandlingWithFallback() {
  const { UARTSource } = require("./src/services/uart");
  const { SimulationSource } = require("./src/services/simulation/simulationSource");

  let source = new UARTSource({ port: "/dev/ttyAMA0" });

  // Versuche UART
  try {
    console.log("🔌 Trying UART...");
    await source.start();
    console.log("✅ UART connected");
  } catch (err) {
    // Fallback auf Simulation
    console.error("❌ UART failed:", err.message);
    console.log("🎬 Switching to Simulation");

    source = new SimulationSource();
    await source.start();
    console.log("✅ Simulation started");
  }

  // Beide Quellen funktionieren gleich
  let count = 0;
  source.on("data", (data) => {
    count++;
    if (count % 50 === 0) {
      console.log(`✓ Processed ${count} messages from ${data.source}`);
    }
  });

  source.on("error", (err) => {
    console.error("⚠️ Source error:", err.message);
  });

  // Laufe für 60 Sekunden
  setTimeout(async () => {
    await source.stop();
    console.log(`✅ Session complete (${count} messages)`);
  }, 60000);
}

// ============================================================================
// MAIN: Wähle welches Beispiel ausgeführt werden soll
// ============================================================================

if (require.main === module) {
  const exampleNum = process.argv[2] || "1";

  console.log(`\n📌 Running Example ${exampleNum}\n`);

  const examples = {
    "1": example_basicUARTClient,
    "2": example_uartSourcePipeline,
    "3": example_sendCommand,
    "4": example_dataSourceToggle,
    "5": example_crcVerification,
    "6": example_expressIntegration,
    "7": example_errorHandlingWithFallback
  };

  const example = examples[exampleNum];
  if (!example) {
    console.error("Unknown example:", exampleNum);
    process.exit(1);
  }

  example().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}

module.exports = {
  example_basicUARTClient,
  example_uartSourcePipeline,
  example_sendCommand,
  example_dataSourceToggle,
  example_crcVerification,
  example_expressIntegration,
  example_errorHandlingWithFallback
};
