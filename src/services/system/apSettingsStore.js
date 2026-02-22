/**
 * @file apSettingsStore.js
 * @brief Persistente Speicherung der AP-Einstellungen (JSON-Datei)
 * 
 * Speichert AP-Konfiguration wie den Idle-Timer in einer JSON-Datei,
 * damit die Einstellungen nach einem Reboot erhalten bleiben.
 * 
 * Datei: /home/chris/DA-WebApp/ap-settings.json
 */

const fs = require("fs");
const path = require("path");

/** Pfad zur Settings-Datei (neben package.json im Projekt-Root) */
const SETTINGS_FILE = path.resolve(__dirname, "../../../ap-settings.json");

/** Standard-Einstellungen */
const DEFAULTS = {
  idleTimeoutMs: 180000, // 3 Minuten
};

/**
 * Lade AP-Einstellungen aus JSON-Datei
 * @returns {Object} Einstellungen (mit Defaults falls Datei fehlt)
 */
function loadAPSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed };
    }
  } catch (err) {
    console.warn(`[APSettings] Konnte nicht geladen werden: ${err.message} – verwende Defaults`);
  }
  return { ...DEFAULTS };
}

/**
 * Speichere AP-Einstellungen in JSON-Datei
 * @param {Object} settings - Zu speichernde Einstellungen
 */
function saveAPSettings(settings) {
  try {
    const current = loadAPSettings();
    const merged = { ...current, ...settings };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), "utf-8");
    console.log(`[APSettings] Gespeichert: ${SETTINGS_FILE}`);
    return merged;
  } catch (err) {
    console.error(`[APSettings] Speichern fehlgeschlagen: ${err.message}`);
    throw err;
  }
}

/**
 * Lese nur den Idle-Timeout-Wert
 * @returns {number} Idle Timeout in ms
 */
function getIdleTimeoutMs() {
  const settings = loadAPSettings();
  return settings.idleTimeoutMs;
}

/**
 * Setze den Idle-Timeout-Wert
 * @param {number} ms - Timeout in Millisekunden (min: 30000, max: 600000)
 * @returns {number} Der tatsächlich gespeicherte Wert
 */
function setIdleTimeoutMs(ms) {
  // Clamp: 30 Sekunden bis 10 Minuten
  const clamped = Math.max(30000, Math.min(600000, Math.floor(ms)));
  saveAPSettings({ idleTimeoutMs: clamped });
  return clamped;
}

module.exports = { loadAPSettings, saveAPSettings, getIdleTimeoutMs, setIdleTimeoutMs, DEFAULTS };
