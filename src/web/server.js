// src/web/server.js
const http = require("http");
const { Server } = require("socket.io");
const express = require("express");
const path = require("path");

const webRoutes = require("./routes");
const { SimulationSource } = require("../services/simulation/simulationSource");
const { SensorProcessor } = require("../services/processing/sensorProcessor");

function createWebServer({ port = 3000 } = {}) {
  const app = express();

  // Static files
  app.use(express.static(path.join(__dirname, "public")));
  app.use("/", webRoutes);

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
