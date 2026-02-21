// src/web/server.js
require("dotenv").config();

const http = require("http");
const { Server } = require("socket.io");
const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const apiRoutes = require("./routes/api");

const webRoutes = require("./routes");
const { SimulationSource } = require("../services/simulation/simulationSource");
const { UARTSource } = require("../services/uart/uartSource");
const { SensorProcessor } = require("../services/processing/sensorProcessor");
const { pingDb } = require("../services/database/connection");
const { listUsers, createUser } = require("../services/database/userStore");
const { ensureSession, getActiveUser, setActiveUser } = require("../services/database/sessionStore");
const { initializeFilterPresetsTable } = require("../services/database/filterPresetStore");
const APManager = require("../services/ap/apManager");

/**
 * Erstelle Web-Server mit Sensor-Datenerfassung
 * 
 * Datenquellen-Konfiguration:
 *  - UART_ENABLED=true + UART_PORT=/dev/ttyAMA0 → UARTSource (Echtdaten von ESP32)
 *  - UART_ENABLED=false → SimulationSource (Demo-Daten)
 * 
 * @param {Object} options - Server-Optionen
 * @param {number} options.port - Web-Server Port (default: 3000)
 * @returns {Object} { app, io, httpServer, source }
 */
function createWebServer({ port = 3000 } = {}) {
  const app = express();

  app.use(express.json());
  app.use(cookieParser());

  // Static files
  app.use(express.static(path.join(__dirname, "public")));
  
  // Web Routes (Dashboard, Health, etc.)
  app.use("/", webRoutes);
  
  // API Routes
  app.use("/api", apiRoutes);

  const httpServer = http.createServer(app);

  const io = new Server(httpServer, {
    // same-origin default passt für lokale Pi-WebApp; CORS erst nötig bei getrennten Origins
  });

  // --- Wähle Datenquelle basierend auf Umgebungsvariablen ---
  const useUART = process.env.UART_ENABLED === "true";
  const uartPort = process.env.UART_PORT || "/dev/ttyAMA0";
  const uartBaud = parseInt(process.env.UART_BAUD || "115200");

  let source;

  if (useUART) {
    console.log(`📡 Using UART as data source: ${uartPort} @ ${uartBaud} baud`);
    source = new UARTSource({ port: uartPort, baudRate: uartBaud, logging: true });
  } else {
    console.log(`🎬 Using Simulation as data source`);
    source = new SimulationSource({ hz: 50, radius: 80, periodMs: 4000 });
  }

  // --- Pipeline: DataSource -> Processing -> Socket.IO ---
  const processor = new SensorProcessor({ outMin: -100, outMax: 100 });
  
  let logCounter = 0;  // Für reduziertes Logging (nur jeder 10. Frame)

  // Verstärke Sensor-Daten Events mit Processing
  source.on("data", (raw) => {
    const processed = processor.process(raw);
    const status = source.getStatus();
    
    logCounter++;
    
    // Detailliertes Logging nur alle 5 Frames (ca. 10Hz bei 50Hz Quelle)
    if (logCounter % 5 === 0) {
      console.log(
        `[DATA] Raw:[${String(raw.raw.u).padStart(4)}|${String(raw.raw.l).padStart(4)}|${String(raw.raw.d).padStart(4)}|${String(raw.raw.r).padStart(4)}] ` +
        `Filt:[${String(raw.filtered.u).padStart(4)}|${String(raw.filtered.l).padStart(4)}|${String(raw.filtered.d).padStart(4)}|${String(raw.filtered.r).padStart(4)}] ` +
        `Vec:(vx=${(raw.vx).toFixed(2)}, vy=${(raw.vy).toFixed(2)}) Mag=${(Math.sqrt(raw.vx*raw.vx + raw.vy*raw.vy)).toFixed(3)} ` +
        `Freq=${status.frequency} Hz`
      );
    }
    
    io.emit("joystick:update", {
      ts: raw.ts,
      source: raw.source,
      
      // --- Raw Sensor Values (0-4095) ---
      raw: raw.raw,
      
      // --- Filtered Sensor Values (0-4095) ---
      filtered: raw.filtered,
      
      // --- Normalized Sensor Values (0...1) per Sensor ---
      normalized: raw.normalized,
      
      // --- Joystick Vector (-1...+1) NORMALIZED ---
      // Diese sind die URSPRÜNGLICHEN Vektor-Komponenten vom ESP32
      vx: raw.vx || 0,
      vy: raw.vy || 0,
      
      // --- Joystick Vector (-100...100) SCALED ---
      // Diese sind vom SensorProcessor skaliert
      x: processed.x || 0,
      y: processed.y || 0,
      magnitude: processed.magnitude || 0,
      deadzone: processed.deadzone || false,
      
      // --- Debug Info ---
      frameInfo: {
        messageCount: status.messageCount || 0,
        frequency: status.frequency || 0
      }
    });
  });

  // Error Handling für Datenquelle
  source.on("error", (err) => {
    console.error(
      `⚠️ Data source error [${err.type}]:`,
      err.message || err
    );
    // Fehler an Clients weiterleiten
    io.emit("system:error", {
      type: err.type,
      message: err.message,
      ts: err.ts || Date.now()
    });
  });

  // Verbindungs-Status Tracking
  source.on("started", () => {
    console.log(`✅ Data source started (${useUART ? "UART" : "Simulation"})`);
    io.emit("system:status", {
      status: "connected",
      source: useUART ? "uart" : "simulation",
      ts: Date.now()
    });
  });

  source.on("stopped", () => {
    console.log(`⏹️ Data source stopped`);
    io.emit("system:status", {
      status: "disconnected",
      ts: Date.now()
    });
  });

  source.on("disconnected", () => {
    console.warn(`⚠️ Data source disconnected unexpectedly`);
    io.emit("system:status", {
      status: "disconnected",
      reason: "unexpected",
      ts: Date.now()
    });
  });

  // Wenn Datenquelle eine UARTSource ist, lausche auf Config-Responses
  if (source && typeof source.on === 'function') {
    source.on('config', (payload) => {
      try {
        // payload is a Buffer
        // Parse flexibly: support minimal FSR-only (5 bytes) or extended format
        const buf = payload;
        const parsed = {};
        if (!buf || buf.length === 0) {
          return;
        }

        // If buffer length >= 5 we expect at least version + some data
        // Our preferred extended format (recommended):
        // [ver:1][filterType:1][noiseGate:2 BE][fsrMax:2 BE][hidPollMs:2 BE][hidMaxDelta:1]
        // minimal legacy format (as present today) may be 5 bytes and only report firmware/caps

        parsed.raw = Array.from(buf);

        if (buf.length >= 5) {
          // Try to extract FSR params if present (positions based on extended layout)
          // Search for plausible uint16 values in buffer (best-effort)
          if (buf.length >= 6) {
            // If extended format: assume filterType at index 1, noiseGate at 2..3, fsrMax at 4..5
            parsed.filterType = buf[1];
            if (buf.length >= 6) {
              parsed.noiseGate = buf.readUInt16BE ? buf.readUInt16BE(2) : (buf[2]<<8|buf[3]);
            }
            if (buf.length >= 8) {
              parsed.fsrMax = buf.readUInt16BE ? buf.readUInt16BE(4) : (buf[4]<<8|buf[5]);
            }
          }
          if (buf.length >= 11) {
            parsed.hidPollMs = buf.readUInt16BE(6);
            parsed.hidMaxDelta = buf[8];
          }
        }

        // Veröffentliche an Web-Clients
        io.emit('system:config', parsed);
      } catch (err) {
        console.error('Error parsing config payload:', err.message);
      }
    });
  }

  // WebSocket Connection Handler
  io.on("connection", (socket) => {
    socket.emit("server:hello", {
      ts: Date.now(),
      msg: "connected",
      source: useUART ? "uart" : "simulation"
    });

    // Sende Status-Update wenn Client verbindet
    socket.emit("system:status", {
      status: source.isRunning ? "connected" : "disconnected",
      source: useUART ? "uart" : "simulation",
      ts: Date.now()
    });

    // Client fordert Status an
    socket.on("request:status", () => {
      socket.emit("system:status", {
        status: source.isRunning ? "connected" : "disconnected",
        source: useUART ? "uart" : "simulation",
        sourceStats: source.getStatus(),
        ts: Date.now()
      });
    });

    // Client fordert Datenquellen-Umschaltung an (optional)
    socket.on("system:source-switch", (msg) => {
      console.log(`[Socket] Client requested source switch to: ${msg.targetSource}`);
      // Diese Logik könnte später erweitert werden für dynamisches Umschalten
      socket.emit("system:error", {
        type: "NOT_IMPLEMENTED",
        message: "Source switching is not yet supported",
        ts: Date.now()
      });
    });

    // Client fordert aktuelle Konfiguration an
    socket.on('request:config', async () => {
      try {
        // Fordere ESP32 (oder Quelle) auf Config zu senden
        if (source && typeof source.requestConfig === 'function') {
          await source.requestConfig();
        } else if (source && source.client && typeof source.client.requestSensorData === 'function') {
          // Fallback: directly call client
          await source.client.requestSensorData();
        } else {
          socket.emit('system:config', { message: 'no-source' });
        }
      } catch (err) {
        socket.emit('system:config', { message: err.message });
      }
    });

    // Client sendet Filter-Einstellungen an Server -> weiterleiten an ESP32
    socket.on("filter:set", async (settings, callback) => {
      try {
        // Erwartetes Format: { filter: 'ma'|'lpf', noiseGate: 0-4095, fsrMax: 0-4095 }
        if (!settings || typeof settings !== "object") {
          const msg = "Invalid settings payload";
          if (callback) callback({ success: false, message: msg });
          socket.emit("filter:ack", { success: false, message: msg });
          return;
        }

        const filterType = settings.filter === "lpf" ? 2 : 1; // 1=MA, 2=LPF
        const noiseGate = Math.max(0, Math.min(4095, Number(settings.noiseGate) || 0));
        const fsrMax = Math.max(0, Math.min(4095, Number(settings.fsrMax) || 0));

        // Payload Layout (cmdData): [filterType:1B][noiseGate:2B BE][fsrMax:2B BE]
        const cmdData = Buffer.allocUnsafe(5);
        cmdData[0] = filterType;
        cmdData.writeUInt16BE(noiseGate, 1);
        cmdData.writeUInt16BE(fsrMax, 3);

        const CMD_FILTER_CONFIG = 0x20; // Command ID for filter config (ESP32 mapping)

        // If source supports sendCommand, forward to ESP32 (UARTSource)
        let sendOk = false;
        if (source && typeof source.sendCommand === "function") {
          sendOk = await source.sendCommand(CMD_FILTER_CONFIG, cmdData);
        } else {
          console.warn("[Socket] No UART source available to send filter settings");
        }

        const resp = { success: !!sendOk };
        if (callback) callback(resp);
        socket.emit("filter:ack", resp);
      } catch (err) {
        console.error("[Socket] filter:set error:", err.message);
        if (callback) callback({ success: false, message: err.message });
        socket.emit("filter:ack", { success: false, message: err.message });
      }
    });

    // Client sendet HID-Maus Einstellungen
    socket.on('hid:set', async (settings, callback) => {
      try {
        if (!settings || typeof settings !== 'object') {
          const msg = 'Invalid HID settings payload';
          if (callback) callback({ success: false, message: msg });
          socket.emit('hid:ack', { success: false, message: msg });
          return;
        }

        const pollMs = Math.max(1, Math.min(60000, Number(settings.pollMs) || 10));
        const maxDelta = Math.max(0, Math.min(255, Number(settings.maxDelta) || 10));

        // CMD for HID config
        const CMD_HID_CONFIG = 0x21;
        // Payload: [pollMs:2B BE][maxDelta:1B]
        const cmdData = Buffer.allocUnsafe(3);
        cmdData.writeUInt16BE(pollMs, 0);
        cmdData[2] = maxDelta;

        let sendOk = false;
        if (source && typeof source.sendCommand === 'function') {
          sendOk = await source.sendCommand(CMD_HID_CONFIG, cmdData);
        } else {
          console.warn('[Socket] No UART source available to send HID settings');
        }

        const resp = { success: !!sendOk };
        if (callback) callback(resp);
        socket.emit('hid:ack', resp);
      } catch (err) {
        console.error('[Socket] hid:set error:', err.message);
        if (callback) callback({ success: false, message: err.message });
        socket.emit('hid:ack', { success: false, message: err.message });
      }
    });
  });

  // HTTP Server Start
  httpServer.listen(port, async () => {
    try {
      // Initialisiere Datenbank-Tabellen
      await initializeFilterPresetsTable();
      
      // Starte Datenquelle
      await source.start();
      
      // Initialisiere Access Point Manager (wenn UART aktiv)
      if (useUART && source instanceof UARTSource) {
        try {
          const apManager = new APManager(source);
          await apManager.init();
          console.log(`📶 Access Point Manager initialized`);
        } catch (apErr) {
          console.warn(`⚠️ AP Manager initialization failed:`, apErr.message);
          // Fahre fort auch wenn AP fehlschlägt - ist nicht kritisch
        }
      }
      
      console.log(`🚀 Web server listening on http://localhost:${port}`);
    } catch (err) {
      console.error(
        `❌ Failed to start data source:`,
        err.message
      );
      if (useUART) {
        console.error(`   Falling back to Simulation...`);
        const fallbackSource = new SimulationSource({ hz: 50, radius: 80, periodMs: 4000 });
        fallbackSource.on("data", (raw) => {
          const processed = processor.process(raw);
          io.emit("joystick:update", {
            ts: raw.ts,
            source: raw.source,
            ...processed
          });
        });
        await fallbackSource.start();
        // Ersetze source im Closure
        Object.assign(source, fallbackSource);
      } else {
        process.exit(1);
      }
    }
  });

  return { app, io, httpServer, source };
}

module.exports = { createWebServer };

/**
 * Graceful Shutdown Handler
 * Wird aufgerufen bei SIGINT (Ctrl+C) oder SIGTERM
 */
function setupGracefulShutdown(httpServer, source) {
  const signals = ["SIGINT", "SIGTERM"];

  signals.forEach((signal) => {
    process.on(signal, async () => {
      console.log(`\n📛 ${signal} received. Shutting down gracefully...`);

      // Schließe HTTP Server
      httpServer.close(async () => {
        console.log(`✓ HTTP server closed`);

        // Stoppe Datenquelle
        if (source && source.stop) {
          try {
            await source.stop();
            console.log(`✓ Data source stopped`);
          } catch (err) {
            console.error(`⚠️ Error stopping data source:`, err.message);
          }
        }

        console.log(`✅ Server shutdown complete`);
        process.exit(0);
      });

      // Timeout für erzwungenes Herunterfahren nach 10 Sekunden
      setTimeout(() => {
        console.error(`❌ Forced shutdown (timeout)`);
        process.exit(1);
      }, 10000);
    });
  });
}

// Wenn server.js direkt mit "node src/web/server.js" gestartet wird:
if (require.main === module) {
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  const { httpServer, source } = createWebServer({ port });

  // Richte Graceful Shutdown ein
  setupGracefulShutdown(httpServer, source);
}

function getOrCreateSessionId(req, res) {
  let sid = req.cookies.sid;
  if (!sid) {
    sid = crypto.randomUUID();
    res.cookie("sid", sid, { httpOnly: true, sameSite: "lax" });
  }
  return sid;
}
