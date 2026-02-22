/**
 * @file apService.js
 * @brief Access Point Service – Hotspot-Verwaltung mit dynamischem Passwort
 * 
 * Verantwortlichkeit:
 *  - Generiert beim Boot ein zufälliges 16-stelliges alphanumerisches Passwort
 *  - Sendet Passwort per UART (0x41) an ESP32 und wartet auf ACK (0x42)
 *  - Konfiguriert NetworkManager-Hotspot mit dem neuen Passwort
 *  - Überwacht verbundene WLAN-Clients
 *  - Fährt Pi nach 3 Minuten ohne Client herunter (Idle-Shutdown)
 *  - Schützt USB Ethernet Gadget (usb0) vor Konflikten
 * 
 * Architektur:
 *   apService → UARTClient (0x41 Password Data)
 *            → ESP32 (0x42 Password ACK)
 *            → nmcli (NetworkManager Hotspot)
 *            → shutdown (Idle-Timer)
 */

const { execSync, exec } = require("child_process");
const crypto = require("crypto");
const { EventEmitter } = require("events");
const { getIdleTimeoutMs, setIdleTimeoutMs } = require("./apSettingsStore");

/* ============================================================
 * Konfiguration
 * ============================================================ */

/** Hotspot-Name (SSID) */
const AP_SSID = process.env.AP_SSID || "Nullweg-Joystick";

/** WLAN-Interface für den Hotspot */
const AP_IFACE = process.env.AP_IFACE || "wlan0";

/** NetworkManager Connection-Name (intern) */
const AP_CON_NAME = "da-hotspot";

/** Passwort-Länge (muss 16 sein für ESP32-Kompatibilität) */
const AP_PASSWORD_LEN = 16;

/**
 * Idle-Timeout: Shutdown nach dieser Zeit ohne Client [ms]
 * Wird beim Start aus der persistenten ap-settings.json geladen.
 * Kann zur Laufzeit über setIdleTimeout() geändert werden.
 */
let IDLE_TIMEOUT_MS = getIdleTimeoutMs();

/** Wie oft Clients geprüft werden [ms] */
const CLIENT_CHECK_INTERVAL_MS = parseInt(process.env.AP_CHECK_INTERVAL_MS || "10000"); // 10s

/** Maximale Anzahl von UART-Retries für Passwort-Übertragung */
const MAX_PASSWORD_RETRIES = 10;

/** Timeout für ACK-Antwort vom ESP32 [ms] */
const PASSWORD_ACK_TIMEOUT_MS = 5000;

/** Intervall zwischen Password-Sende-Versuchen [ms] */
const PASSWORD_RETRY_INTERVAL_MS = 6000;

/* ============================================================
 * Passwort-Generierung
 * ============================================================ */

/**
 * Generiere ein kryptographisch sicheres 16-stelliges alphanumerisches Passwort
 * Nur: A-Z, a-z, 0-9 (kompatibel mit ESP32 apServiceValidatePassword)
 * @returns {string} 16-Zeichen Passwort
 */
function generatePassword() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let password = "";
  const randomBytes = crypto.randomBytes(AP_PASSWORD_LEN);
  for (let i = 0; i < AP_PASSWORD_LEN; i++) {
    password += chars[randomBytes[i] % chars.length];
  }
  return password;
}

/* ============================================================
 * AP Service Klasse
 * ============================================================ */

class APService extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.uartSource - UARTSource Instanz (muss .client mit sendPasswordData haben)
   * @param {boolean} options.logging - Logging aktivieren
   */
  constructor({ uartSource = null, logging = true } = {}) {
    super();
    this.uartSource = uartSource;
    this.logging = logging;

    this.password = null;
    this.passwordAcked = false;
    this.passwordRetries = 0;

    this.hotspotActive = false;
    this.clientCount = 0;
    this.lastClientSeenTime = Date.now();
    this.idleShutdownArmed = false;

    this._clientCheckInterval = null;
    this._passwordRetryTimeout = null;
    this._idleTimeout = null;
    this._ackResolver = null;
  }

  /**
   * Starte den AP Service
   * 
   * Ablauf:
   * 1. Generiere Passwort
   * 2. Sende Passwort an ESP32, warte auf ACK
   * 3. Konfiguriere Hotspot mit Passwort
   * 4. Starte Client-Monitoring
   */
  async start() {
    this.log("🚀 AP Service startet...");

    // 1. Generiere neues Passwort
    this.password = generatePassword();
    this.log(`🔑 Passwort generiert: ${this.password}`);

    // 2. Sende Passwort an ESP32 (mit Retry-Logik)
    if (this.uartSource && this.uartSource.client) {
      await this._sendPasswordToESP32();
    } else {
      this.log("⚠️ Kein UART Source verfügbar – überspringe ESP32 Passwort-Übertragung");
    }

    // 3. Konfiguriere und starte Hotspot
    await this._startHotspot();

    // 4. Starte Client-Monitoring mit Idle-Shutdown
    this._startClientMonitoring();

    this.log("✅ AP Service gestartet");
    this.emit("started", { ssid: AP_SSID, password: this.password });
  }

  /**
   * Stoppe den AP Service
   */
  async stop() {
    this.log("⏹️ AP Service wird gestoppt...");

    // Timer aufräumen
    if (this._clientCheckInterval) {
      clearInterval(this._clientCheckInterval);
      this._clientCheckInterval = null;
    }
    if (this._passwordRetryTimeout) {
      clearTimeout(this._passwordRetryTimeout);
      this._passwordRetryTimeout = null;
    }
    if (this._idleTimeout) {
      clearTimeout(this._idleTimeout);
      this._idleTimeout = null;
    }

    // Hotspot stoppen (optional – bei Shutdown nicht nötig)
    try {
      this._stopHotspot();
    } catch (err) {
      this.log(`⚠️ Fehler beim Stoppen des Hotspots: ${err.message}`);
    }

    this.log("✅ AP Service gestoppt");
  }

  /* ============================================================
   * UART Password Handshake
   * ============================================================ */

  /**
   * Sende Passwort an ESP32 und warte auf ACK (0x42)
   * Retry-Logik: bis zu MAX_PASSWORD_RETRIES Versuche
   * @private
   */
  async _sendPasswordToESP32() {
    const client = this.uartSource.client;

    // Lausche auf password_req (0x40) Events vom ESP32
    // Der ESP32 sendet alle 5s einen 0x40 Request
    // WICHTIG: Immer antworten (Heartbeat) – nicht nur beim Startup!
    // Dadurch bleibt ESP32 "Pi: ON" Status aktiv (30s Timeout im ESP32)
    client.on("password_req", () => {
      if (this.password) {
        // Sende Passwort als Heartbeat-Antwort (hält "Pi: ON" am LCD)
        client.sendPasswordData(this.password).catch((err) => {
          this.log(`⚠️ Heartbeat-Passwort senden fehlgeschlagen: ${err.message}`);
        });
      }
    });

    // Lausche auf password_ack (0x42) Events
    client.on("password_ack", (data) => {
      if (data.status === 1) {
        if (!this.passwordAcked) {
          this.log("✅ ESP32 hat Passwort bestätigt (0x42 ACK)");
        }
        this.passwordAcked = true;
        if (this._ackResolver) {
          this._ackResolver(true);
          this._ackResolver = null;
        }
        this.emit("password_acked");
      } else {
        this.log(`⚠️ ESP32 Passwort-ACK mit Fehler-Status: ${data.status}`);
      }
    });

    // Warte auf erstes ACK mit Timeout und Retries
    return this._waitForPasswordAck();
  }

  /**
   * Sende einen einzelnen Passwort-Frame (0x41)
   * @private
   */
  async _trySendPassword() {
    if (this.passwordAcked) return;

    const client = this.uartSource.client;
    this.passwordRetries++;

    this.log(`📤 Sende Passwort (0x41) an ESP32 – Versuch ${this.passwordRetries}/${MAX_PASSWORD_RETRIES}`);

    try {
      const success = await client.sendPasswordData(this.password);
      if (!success) {
        this.log("⚠️ Passwort konnte nicht gesendet werden (UART nicht verbunden?)");
      }
    } catch (err) {
      this.log(`❌ Fehler beim Senden: ${err.message}`);
    }
  }

  /**
   * Warte auf Password ACK mit Retry-Mechanismus
   * Wartet maximal MAX_PASSWORD_RETRIES * PASSWORD_RETRY_INTERVAL_MS
   * @private
   * @returns {Promise<boolean>} true wenn ACK empfangen
   */
  _waitForPasswordAck() {
    return new Promise((resolve) => {
      // Speichere resolve-Funktion damit ACK-Handler sofort resolven kann
      this._ackResolver = (result) => {
        this._ackResolver = null;
        clearInterval(retryInterval);
        clearTimeout(hardTimeout);
        resolve(result);
      };

      // Sende sofort den ersten Versuch
      this._trySendPassword();

      const retryInterval = setInterval(() => {
        if (this.passwordAcked) {
          if (this._ackResolver) this._ackResolver(true);
          return;
        }

        if (this.passwordRetries >= MAX_PASSWORD_RETRIES) {
          this.log(`❌ ESP32 Passwort-ACK nach ${MAX_PASSWORD_RETRIES} Versuchen nicht erhalten`);
          this.log("⚠️ Hotspot wird trotzdem gestartet (ESP32 zeigt ggf. altes Passwort)");
          if (this._ackResolver) this._ackResolver(false);
          return;
        }

        this._trySendPassword();
      }, PASSWORD_RETRY_INTERVAL_MS);

      // Hard-Timeout: Nie länger als alle Retries × Interval + Puffer blockieren
      const maxWait = (MAX_PASSWORD_RETRIES + 1) * PASSWORD_RETRY_INTERVAL_MS;
      const hardTimeout = setTimeout(() => {
        if (!this.passwordAcked) {
          this.log("⏰ Password-Handshake Timeout – fahre fort");
          if (this._ackResolver) this._ackResolver(false);
        }
      }, maxWait);
    });
  }

  /* ============================================================
   * NetworkManager Hotspot
   * ============================================================ */

  /**
   * Starte Hotspot über NetworkManager (nmcli)
   * 
   * Wichtig: Wir verwenden eine benannte Connection, damit wir sie
   *          gezielt starten/stoppen können ohne andere Interfaces zu stören.
   *          USB Ethernet (usb0) bleibt unberührt!
   * @private
   */
  async _startHotspot() {
    this.log(`📡 Konfiguriere Hotspot: SSID="${AP_SSID}" auf ${AP_IFACE}`);

    try {
      // Prüfe ob eine alte Connection mit dem Namen existiert
      const existingCon = this._nmcli(`con show "${AP_CON_NAME}" 2>/dev/null`, true);
      
      if (existingCon !== null) {
        // Alte Connection updaten (Passwort ändern)
        this.log("🔄 Aktualisiere bestehende Hotspot-Connection...");
        this._nmcli(`con modify "${AP_CON_NAME}" wifi-sec.psk "${this.password}"`);
        this._nmcli(`con modify "${AP_CON_NAME}" wifi.ssid "${AP_SSID}"`);
      } else {
        // Neue Connection erstellen
        this.log("🆕 Erstelle neue Hotspot-Connection...");
        this._nmcli(
          `con add type wifi ifname ${AP_IFACE} con-name "${AP_CON_NAME}" ` +
          `autoconnect no ` +
          `ssid "${AP_SSID}" ` +
          `-- wifi.mode ap ` +
          `wifi.band bg ` +
          `wifi-sec.key-mgmt wpa-psk ` +
          `wifi-sec.psk "${this.password}" ` +
          `ipv4.method shared ` +
          `ipv4.addresses 192.168.4.1/24`
        );
      }

      // Connection aktivieren
      this._nmcli(`con up "${AP_CON_NAME}"`);
      this.hotspotActive = true;
      this.log(`✅ Hotspot aktiv: SSID="${AP_SSID}", IP=192.168.4.1`);

    } catch (err) {
      this.log(`❌ Hotspot-Start fehlgeschlagen: ${err.message}`);
      this.emit("error", { type: "HOTSPOT_START_ERROR", message: err.message });
      throw err;
    }
  }

  /**
   * Stoppe Hotspot
   * @private
   */
  _stopHotspot() {
    try {
      this._nmcli(`con down "${AP_CON_NAME}" 2>/dev/null`, true);
      this.hotspotActive = false;
      this.log("⏹️ Hotspot gestoppt");
    } catch (err) {
      // Ignoriere wenn bereits gestoppt
    }
  }

  /**
   * nmcli Wrapper
   * @private
   * @param {string} args - nmcli Argumente
   * @param {boolean} allowFail - true = gibt null zurück statt Exception
   * @returns {string|null}
   */
  _nmcli(args, allowFail = false) {
    const cmd = `sudo nmcli ${args}`;
    try {
      const result = execSync(cmd, {
        encoding: "utf-8",
        timeout: 15000,
        stdio: ["pipe", "pipe", "pipe"]
      });
      return result.trim();
    } catch (err) {
      if (allowFail) return null;
      throw new Error(`nmcli Fehler: ${err.stderr || err.message}`);
    }
  }

  /* ============================================================
   * Client-Monitoring & Idle-Shutdown
   * ============================================================ */

  /**
   * Starte periodische Prüfung der verbundenen WLAN-Clients
   * @private
   */
  _startClientMonitoring() {
    this.lastClientSeenTime = Date.now();
    this.idleShutdownArmed = true;

    this.log(`👥 Client-Monitoring gestartet (Check alle ${CLIENT_CHECK_INTERVAL_MS / 1000}s, Idle-Timeout: ${IDLE_TIMEOUT_MS / 1000}s)`);

    this._clientCheckInterval = setInterval(() => {
      this._checkClients();
    }, CLIENT_CHECK_INTERVAL_MS);

    // Sofortige erste Prüfung
    this._checkClients();
  }

  /**
   * Prüfe Anzahl verbundener WLAN-Clients
   * Verwendet `iw` um die Station-Liste des AP-Interface abzufragen.
   * Sendet AP_STATUS (0x43) an ESP32 nach jeder Prüfung.
   * @private
   */
  _checkClients() {
    try {
      // iw dev wlan0 station dump – zeigt alle verbundenen Stationen
      const output = execSync(`sudo iw dev ${AP_IFACE} station dump 2>/dev/null`, {
        encoding: "utf-8",
        timeout: 5000
      });

      // Zähle "Station" Einträge
      const stationMatches = output.match(/^Station /gm);
      const clientCount = stationMatches ? stationMatches.length : 0;

      const prevCount = this.clientCount;
      this.clientCount = clientCount;

      // Log nur bei Änderung
      if (clientCount !== prevCount) {
        this.log(`👥 Clients: ${clientCount} (vorher: ${prevCount})`);
        this.emit("clients_changed", { count: clientCount });
      }

      if (clientCount > 0) {
        // Client(s) verbunden → Timer zurücksetzen
        this.lastClientSeenTime = Date.now();
        
        if (this._idleTimeout) {
          clearTimeout(this._idleTimeout);
          this._idleTimeout = null;
        }

        // Sende AP_STATUS an ESP32: Clients verbunden, kein Timer
        this._sendAPStatus(clientCount, 0, 0x01); // AP_FLAG_ACTIVE
      } else {
        // Keine Clients → Idle-Countdown prüfen
        this._checkIdleShutdown();
      }

    } catch (err) {
      // iw Fehler = wahrscheinlich kein AP aktiv, trotzdem Timer laufen lassen
      this.clientCount = 0;
      this._checkIdleShutdown();
    }
  }

  /**
   * Prüfe ob Idle-Timeout erreicht ist und fahre ggf. herunter
   * @private
   */
  _checkIdleShutdown() {
    if (!this.idleShutdownArmed) return;

    const elapsed = Date.now() - this.lastClientSeenTime;
    const remaining = IDLE_TIMEOUT_MS - elapsed;

    if (remaining <= 0) {
      this.log(`⏰ Idle-Timeout erreicht (${IDLE_TIMEOUT_MS / 1000}s ohne Client) → SHUTDOWN`);
      this.emit("idle_shutdown");

      // Sende finalen AP_STATUS mit Shutdown-Flag an ESP32
      this._sendAPStatus(0, 0, 0x01 | 0x04); // AP_FLAG_ACTIVE | AP_FLAG_SHUTDOWN

      this._triggerShutdown();
    } else {
      const remainingSec = Math.ceil(remaining / 1000);

      // Sende AP_STATUS mit Timer-Countdown an ESP32
      this._sendAPStatus(0, remainingSec, 0x01 | 0x02); // AP_FLAG_ACTIVE | AP_FLAG_IDLE_ARMED

      // Debug: verbleibende Zeit loggen (nur alle 30s oder wenn < 10s)
      if (remainingSec % 30 === 0 || remainingSec <= 10) {
        this.log(`⏳ Kein Client – Shutdown in ${remainingSec}s`);
      }
    }
  }

  /**
   * Fahre Raspberry Pi herunter
   * WICHTIG: usb0 (USB Ethernet Gadget) bleibt bis zum Shutdown aktiv,
   *          SSH-Sessions über usb0 werden erst beim Shutdown beendet
   * @private
   */
  _triggerShutdown() {
    this.idleShutdownArmed = false; // Nur einmal auslösen

    // Timer aufräumen
    if (this._clientCheckInterval) {
      clearInterval(this._clientCheckInterval);
    }

    this.log("🔌 Fahre System herunter in 10 Sekunden...");
    this.log("   (SSH über USB-Ethernet bleibt bis zum Shutdown aktiv)");

    // Gib der App 10 Sekunden um sich sauber zu beenden
    setTimeout(() => {
      try {
        this.log("⚡ Shutdown NOW");
        execSync("sudo /sbin/shutdown -h now", { timeout: 10000 });
      } catch (err) {
        // shutdown kann einen "exit code" zurückgeben, das ist OK
        this.log(`Shutdown ausgelöst (${err.message || "OK"})`);
      }
    }, 10000);
  }

  /* ============================================================
   * Utilities
   * ============================================================ */

  /**
   * Sende AP_STATUS (0x43) an ESP32 via UART
   * Payload: [clientCount:1B][remainingSec:2B BE][flags:1B]
   * 
   * Flags:
   *   0x01 = AP aktiv (AP_FLAG_ACTIVE)
   *   0x02 = Idle-Timer bewaffnet (AP_FLAG_IDLE_ARMED)
   *   0x04 = Shutdown steht bevor (AP_FLAG_SHUTDOWN)
   * 
   * @private
   * @param {number} clientCount 
   * @param {number} remainingSec
   * @param {number} flags
   */
  _sendAPStatus(clientCount, remainingSec, flags) {
    if (!this.uartSource || !this.uartSource.client) return;

    this.uartSource.client.sendAPStatus(clientCount, remainingSec, flags).catch((err) => {
      this.log(`⚠️ AP_STATUS senden fehlgeschlagen: ${err.message}`);
    });
  }

  /**
   * Gib aktuellen Status zurück
   * @returns {Object}
   */
  getStatus() {
    return {
      ssid: AP_SSID,
      password: this.password,
      passwordAcked: this.passwordAcked,
      hotspotActive: this.hotspotActive,
      clientCount: this.clientCount,
      idleTimeoutMs: IDLE_TIMEOUT_MS,
      timeSinceLastClient: Date.now() - this.lastClientSeenTime,
      idleShutdownArmed: this.idleShutdownArmed,
      idleRemainingMs: this.idleShutdownArmed && this.clientCount === 0
        ? Math.max(0, IDLE_TIMEOUT_MS - (Date.now() - this.lastClientSeenTime))
        : null
    };
  }

  /**
   * Setze den Idle-Timer zurück (z.B. wenn Client über WebSocket verbunden ist)
   */
  resetIdleTimer() {
    this.lastClientSeenTime = Date.now();
    this.log("🔄 Idle-Timer zurückgesetzt");
  }

  /**
   * Deaktiviere Idle-Shutdown (z.B. für Entwicklung/Debug)
   */
  disableIdleShutdown() {
    this.idleShutdownArmed = false;
    if (this._idleTimeout) {
      clearTimeout(this._idleTimeout);
      this._idleTimeout = null;
    }
    this.log("⚠️ Idle-Shutdown deaktiviert");
  }

  /**
   * Ändere den Idle-Timeout zur Laufzeit und speichere persistent
   * @param {number} ms - Neuer Timeout in Millisekunden (30s – 10min)
   * @returns {number} Der tatsächlich gesetzte Wert (clamped)
   */
  setIdleTimeout(ms) {
    const newVal = setIdleTimeoutMs(ms);
    IDLE_TIMEOUT_MS = newVal;
    this.log(`⏱️ Idle-Timeout geändert auf ${newVal / 1000}s`);

    // Wenn Idle-Timer gerade läuft (keine Clients), setze Timer-Startpunkt neu,
    // damit der neue Timeout ab JETZT gilt statt ab dem alten Startpunkt
    if (this.idleShutdownArmed && this.clientCount === 0) {
      this.lastClientSeenTime = Date.now();
      this.log("🔄 Idle-Timer zurückgesetzt (neuer Timeout aktiv)");
    }

    return newVal;
  }

  /**
   * Gib den aktuellen Idle-Timeout zurück
   * @returns {number} Idle Timeout in Millisekunden
   */
  getIdleTimeout() {
    return IDLE_TIMEOUT_MS;
  }

  log(...args) {
    if (this.logging) {
      console.log("[APService]", ...args);
    }
  }
}

module.exports = { APService, generatePassword };
