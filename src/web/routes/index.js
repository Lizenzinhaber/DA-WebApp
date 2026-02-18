/**
 * @file index.js
 * @brief Web-Routen für öffentliche Seiten
 */

const express = require("express");
const path = require("path");

const router = express.Router();

/**
 * GET / - Haupt-Dashboard mit UART-Sensor-Anzeige
 */
router.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

/**
 * GET /health - Health-Check
 */
router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

module.exports = router;
