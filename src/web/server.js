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
const { APService } = require("../services/system/apService");

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

  app.use(express.json({ limit: "100kb" }));
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
        const buf = payload;
        const parsed = {};
        if (!buf || buf.length === 0) {
          return;
        }

        parsed.raw = Array.from(buf);

        // Extended format: [ver:1][subver:1][noiseGate:2B][fsrMax:2B][maWindow:1][lpfAlpha:1][pollMs:2B][maxDelta:1]
        if (buf.length >= 11) {
          parsed.noiseGate   = buf.readUInt16BE(2);
          parsed.fsrMax      = buf.readUInt16BE(4);
          parsed.maWindow    = buf[6];
          parsed.lpfAlpha    = (buf[7] / 100.0);
          parsed.hidPollMs   = buf.readUInt16BE(8);
          parsed.hidMaxDelta = buf[10];
        } else if (buf.length >= 6) {
          // Legacy 9-byte format fallback
          parsed.noiseGate = buf.readUInt16BE(2);
          parsed.fsrMax    = buf.readUInt16BE(4);
          if (buf.length >= 9) {
            parsed.hidPollMs   = buf.readUInt16BE(6);
            parsed.hidMaxDelta = buf[8];
          }
        }

        io.emit('system:config', parsed);
      } catch (err) {
        console.error('Error parsing config payload:', err.message);
      }
    });
  }

  // WebSocket Connection Handler
  io.on("connection", (socket) => {
    // Idle-Timer zurücksetzen bei WebSocket-Verbindung
    // (ein verbundener Browser-Client zählt als aktiver User)
    if (apService) {
      apService.resetIdleTimer();
    }

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
        // Erwartetes Format: { noiseGate: 0-4095, fsrMax: 0-4095, maWindow: 0-20, lpfAlpha: 0-1 }
        if (!settings || typeof settings !== "object") {
          const msg = "Invalid settings payload";
          if (callback) callback({ success: false, message: msg });
          socket.emit("filter:ack", { success: false, message: msg });
          return;
        }

        const noiseGate  = Math.max(0, Math.min(4095, Number(settings.noiseGate) || 0));
        const fsrMax     = Math.max(0, Math.min(4095, Number(settings.fsrMax) || 0));
        const maWindow   = Math.max(0, Math.min(20, Math.floor(Number(settings.maWindow) || 0)));
        const lpfAlpha   = Math.max(0, Math.min(100, Math.round((Number(settings.lpfAlpha) || 0) * 100)));

        // Payload: [noiseGate:2B BE][fsrMax:2B BE][maWindow:1B][lpfAlphaPercent:1B]
        const cmdData = Buffer.allocUnsafe(6);
        cmdData.writeUInt16BE(noiseGate, 0);
        cmdData.writeUInt16BE(fsrMax, 2);
        cmdData[4] = maWindow;
        cmdData[5] = lpfAlpha;

        const CMD_FILTER_CONFIG = 0x20;

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

  // --- AP Service (Hotspot + Passwort + Idle-Shutdown) ---
  const apEnabled = process.env.AP_SSID || process.env.AP_IFACE;
  let apService = null;

  if (apEnabled && useUART) {
    apService = new APService({ uartSource: source, logging: true });

    apService.on("started", (info) => {
      console.log(`📡 Hotspot aktiv: SSID="${info.ssid}"`);
      io.emit("system:ap", { status: "active", ssid: info.ssid });
    });

    apService.on("clients_changed", ({ count }) => {
      io.emit("system:ap", { status: "active", clients: count });
    });

    apService.on("idle_shutdown", () => {
      io.emit("system:shutdown", { reason: "idle_timeout", ts: Date.now() });
    });

    apService.on("error", (err) => {
      console.error(`[APService] Error: ${err.message}`);
    });
  }

  // API: AP Status Endpoint
  app.get("/api/ap/status", (req, res) => {
    if (apService) {
      res.json(apService.getStatus());
    } else {
      res.json({ active: false, message: "AP Service nicht aktiv" });
    }
  });

  // API: AP Settings – Lesen
  app.get("/api/ap/settings", (req, res) => {
    if (apService) {
      res.json({ idleTimeoutMs: apService.getIdleTimeout() });
    } else {
      // Auch ohne laufenden AP Service die gespeicherten Settings zurückgeben
      const { getIdleTimeoutMs } = require("../services/system/apSettingsStore");
      res.json({ idleTimeoutMs: getIdleTimeoutMs() });
    }
  });

  // API: AP Settings – Schreiben (Idle-Timer ändern)
  app.put("/api/ap/settings", (req, res) => {
    const { idleTimeoutMs } = req.body || {};

    if (idleTimeoutMs === undefined || typeof idleTimeoutMs !== "number") {
      return res.status(400).json({ error: "idleTimeoutMs (number) required" });
    }

    // Clamp: 30s – 10min
    const clamped = Math.max(30000, Math.min(600000, Math.floor(idleTimeoutMs)));

    if (apService) {
      apService.setIdleTimeout(clamped);
    } else {
      // Nur persistent speichern wenn AP Service nicht läuft
      const { setIdleTimeoutMs } = require("../services/system/apSettingsStore");
      setIdleTimeoutMs(clamped);
    }

    // Broadcast an alle Clients
    io.emit("ap:settings", { idleTimeoutMs: clamped });

    res.json({ success: true, idleTimeoutMs: clamped });
  });

  // HTTP Server Start
  httpServer.listen(port, async () => {
    try {
      // Initialisiere Datenbank-Tabellen
      await initializeFilterPresetsTable();
      
      // Starte Datenquelle
      await source.start();

      // Starte AP Service NACH UART-Verbindung
      if (apService) {
        try {
          await apService.start();
        } catch (apErr) {
          console.error(`⚠️ AP Service Fehler (Hotspot nicht gestartet): ${apErr.message}`);
          console.error(`   WebApp läuft weiter ohne Hotspot.`);
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

  return { app, io, httpServer, source, apService };
}

module.exports = { createWebServer };

/**
 * Graceful Shutdown Handler
 * Wird aufgerufen bei SIGINT (Ctrl+C) oder SIGTERM
 */
function setupGracefulShutdown(httpServer, source, apService) {
  const signals = ["SIGINT", "SIGTERM"];

  signals.forEach((signal) => {
    process.on(signal, async () => {
      console.log(`\n📛 ${signal} received. Shutting down gracefully...`);

      // Deaktiviere Idle-Shutdown (wir fahren ja manuell herunter)
      if (apService) {
        apService.disableIdleShutdown();
      }

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

        // Stoppe AP Service
        if (apService) {
          try {
            await apService.stop();
            console.log(`✓ AP Service stopped`);
          } catch (err) {
            console.error(`⚠️ Error stopping AP service:`, err.message);
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
  const { httpServer, source, apService } = createWebServer({ port });

  // Richte Graceful Shutdown ein
  setupGracefulShutdown(httpServer, source, apService);
}

function getOrCreateSessionId(req, res) {
  let sid = req.cookies.sid;
  if (!sid) {
    sid = crypto.randomUUID();
    res.cookie("sid", sid, { httpOnly: true, sameSite: "lax" });
  }
  return sid;
}
