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
const { SensorProcessor } = require("../services/processing/sensorProcessor");
const { pingDb } = require("../services/database/connection");
const { listUsers, createUser } = require("../services/database/userStore");
const { ensureSession, getActiveUser, setActiveUser } = require("../services/database/sessionStore");

function createWebServer({ port = 3000 } = {}) {
  const app = express();

  app.use(express.json());
  app.use(cookieParser());

  // Static files
  app.use(express.static(path.join(__dirname, "public")));
  //app.use("/", webRoutes); //weglassen weil ich api routes verwende
  app.use("/api", apiRoutes);


  const httpServer = http.createServer(app);

  const io = new Server(httpServer, {
    // same-origin default passt für lokale Pi-WebApp; CORS erst nötig bei getrennten Origins
  });

  // --- Pipeline: DataSource -> Processing -> Socket.IO ---
  const processor = new SensorProcessor({ outMin: -100, outMax: 100 });

  const source = new SimulationSource({ hz: 50, radius: 80, periodMs: 4000 });
  source.on("data", (raw) => {
    const processed = processor.process(raw);
    io.emit("joystick:update", {
      ts: raw.ts,
      source: raw.source,
      ...processed
    });
  });

  io.on("connection", (socket) => {
    socket.emit("server:hello", { ts: Date.now(), msg: "connected" });
  });

  httpServer.listen(port, () => {
    source.start();
    console.log(`Web server listening on http://localhost:${port}`);
  });

  return { app, io, httpServer, source };
}

module.exports = { createWebServer };

// Wenn server.js direkt mit "node src/web/server.js" gestartet wird:
if (require.main === module) {
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  createWebServer({ port });
}

function getOrCreateSessionId(req, res) {
  let sid = req.cookies.sid;
  if (!sid) {
    sid = crypto.randomUUID();
    res.cookie("sid", sid, { httpOnly: true, sameSite: "lax" });
  }
  return sid;
}
