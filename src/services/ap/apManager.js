/**
 * @file apManager.js
 * Verwaltet WiFi Access Point mit nmcli
 * - Generiert 16-Zeichen-Passwörter
 * - Sendet Passwort an ESP32 via UART
 * - Auto-Shutdown nach 3 Minuten ohne Clients
 * - Development-Modus für sichere Tests
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const { generateAPPassword, validatePasswordLength } = require('./passwordGenerator');

const execAsync = promisify(exec);

class APManager {
  constructor(uartSource, logger = console) {
    this.uartSource = uartSource;
    this.logger = logger;
    
    // Konfiguration
    this.config = {
      apConnectionName: process.env.AP_CONNECTION_NAME || 'DA-Hotspot',
      apSSID: process.env.AP_SSID || 'RPi-FSR-System',
      devMode: process.env.AP_DEV_MODE === 'true',
      clientCheckIntervalMs: 30 * 1000,      // Alle 30s prüfen
      shutdownDelayMs: 3 * 60 * 1000,        // Nach 3 Minuten no-client shutdown
      emptyClientTimeout: null,               // Timer für Shutdown
      currentPassword: null
    };
    
    this.logger.log('[APManager] Initialisiert:', {
      connection: this.config.apConnectionName,
      ssid: this.config.apSSID,
      devMode: this.config.devMode
    });
  }

  /**
   * Initialisiere den AP-Manager
   * - Generiere Passwort
   * - Sende an ESP32
   * - Starte Client-Überwachung
   */
  async init() {
    try {
      // Generiere erstes Passwort
      const password = generateAPPassword();
      await this.setAPPassword(password);
      
      // Starte Client-Überwachung
      this.startClientMonitoring();
      
      this.logger.log('[APManager] Erfolgreich initialisiert');
    } catch (error) {
      this.logger.error('[APManager] Initialisierungsfehler:', error.message);
    }
  }

  /**
   * Setze das AP-Passwort und sende es an ESP32
   * 
   * @param {string} password - Genau 16 Zeichen langes Passwort
   */
  async setAPPassword(password) {
    // Validiere Passwortlänge
    if (!validatePasswordLength(password)) {
      throw new Error(`Passwort muss genau 16 Zeichen sein, erhalten: ${password.length}`);
    }

    try {
      // Escape single quotes im Passwort (falls vorhanden)
      const escapedPassword = password.replace(/'/g, "'\\''");
      
      // Notiz: nmcli erkennt verschachtelte Quotes nicht gut
      // Format: nmcli connection modify "DA-Hotspot" wifi-sec.psk <password>
      const cmd = `nmcli connection modify '${this.config.apConnectionName}' wifi-sec.psk '${escapedPassword}'`;
      
      this.logger.log('[APManager] Aktualisiere Passwort...');
      const { stdout, stderr } = await execAsync(cmd);
      
      if (stderr && !stderr.includes('Warning')) {
        this.logger.warn('[APManager] nmcli stderr:', stderr);
      }
      
      // Speichere aktuelles Passwort
      this.config.currentPassword = password;
      
      // Sende Passwort an ESP32 via UART (CMD 0x30)
      await this.sendPasswordToESP32(password);
      
      this.logger.log('[APManager] Passwort erfolgreich gesetzt');
    } catch (error) {
      this.logger.error('[APManager] Fehler beim Passwort setzen:', error.message);
      throw error;
    }
  }

  /**
   * Sende Passwort an ESP32 via UART
   * Format: CMD 0x30 + Length + Password (16 bytes)
   * 
   * @param {string} password - 16 Zeichen langes Passwort
   */
  async sendPasswordToESP32(password) {
    try {
      const passwordBytes = Buffer.from(password, 'utf-8');
      
      if (passwordBytes.length !== 16) {
        throw new Error(`ESP32 erwartet 16 Bytes, erhalten: ${passwordBytes.length}`);
      }

      // Baue UART-Frame:
      // [0xAA] [MsgType:0x30] [PayloadLen:1] [Password:16] [CRC8] [0x55]
      const msgType = 0x30;
      const payloadLen = 16;
      
      // Payload: Length (1 Byte) + Password (16 Bytes) = 17 Bytes
      const payload = Buffer.alloc(17);
      payload[0] = payloadLen;
      passwordBytes.copy(payload, 1);
      
      // CRC8 Berechnung über Payload
      const crc8 = this.calculateCRC8(payload);
      
      // Frame zusammenstellen
      const frame = Buffer.alloc(3 + payload.length + 2);
      frame[0] = 0xAA;
      frame[1] = msgType;
      payload.copy(frame, 2);
      frame[2 + payload.length] = crc8;
      frame[3 + payload.length] = 0x55;
      
      // Sende via UARTSource
      if (this.uartSource && this.uartSource.sendData) {
        await this.uartSource.sendData(frame);
        this.logger.log('[APManager] Passwort an ESP32 gesendet');
      } else {
        this.logger.warn('[APManager] UARTSource nicht verfügbar');
      }
    } catch (error) {
      this.logger.error('[APManager] Fehler beim Senden an ESP32:', error.message);
      throw error;
    }
  }

  /**
   * Berechne CRC8 über Payload
   * Polynomiale Methode (wie in ESP32-UART-Code)
   */
  calculateCRC8(buffer) {
    let crc = 0;
    for (let i = 0; i < buffer.length; i++) {
      crc ^= buffer[i];
      for (let j = 0; j < 8; j++) {
        if (crc & 0x80) {
          crc = (crc << 1) ^ 0x07;
        } else {
          crc = crc << 1;
        }
        crc &= 0xFF;
      }
    }
    return crc;
  }

  /**
   * Starte die Überwachung von verbundenen Clients
   * Fahre RPi herunter, wenn 3 Minuten keine Clients verbunden sind
   */
  startClientMonitoring() {
    setInterval(async () => {
      try {
        const clientCount = await this.getConnectedClientCount();
        
        if (clientCount === 0) {
          // Keine Clients verbunden
          if (!this.config.emptyClientTimeout) {
            this.logger.log('[APManager] Keine Clients verbunden, starte Shutdown-Timer (3 Min)');
            
            this.config.emptyClientTimeout = setTimeout(() => {
              if (this.config.devMode) {
                this.logger.warn('[APManager] DEV-MODE: Shutdown deaktiviert!');
              } else {
                this.logger.log('[APManager] Fahre RPi herunter...');
                this.shutdownRPi();
              }
              this.config.emptyClientTimeout = null;
            }, this.config.shutdownDelayMs);
          }
        } else {
          // Clients gefunden - reset Timer
          if (this.config.emptyClientTimeout) {
            clearTimeout(this.config.emptyClientTimeout);
            this.config.emptyClientTimeout = null;
            this.logger.log(`[APManager] Clients gefunden (${clientCount}), Shutdown-Timer zurückgesetzt`);
          }
        }
      } catch (error) {
        this.logger.error('[APManager] Fehler bei Client-Prüfung:', error.message);
      }
    }, this.config.clientCheckIntervalMs);
  }

  /**
   * Zähle verbundene Clients
   * Nutze: iw dev wlan0 station dump
   */
  async getConnectedClientCount() {
    try {
      const { stdout } = await execAsync('iw dev wlan0 station dump');
      
      // Zähle "Station"-Einträge in der Ausgabe
      const stationCount = (stdout.match(/^Station /gm) || []).length;
      
      return stationCount;
    } catch (error) {
      // iw könnte nicht verfügbar sein, versuche nmcli
      try {
        const { stdout } = await execAsync(`nmcli device wifi list --rescan no`);
        // Diese Methode ist weniger präzise, nutze sie als Fallback
        return 0;
      } catch (fallbackError) {
        this.logger.warn('[APManager] Client-Zählung fehlgeschlagen:', error.message);
        return 0;
      }
    }
  }

  /**
   * Fahre RPi herunter
   */
  shutdownRPi() {
    try {
      exec('sudo shutdown -h now', (error) => {
        if (error) {
          this.logger.error('[APManager] Shutdown-Fehler:', error.message);
        }
      });
    } catch (error) {
      this.logger.error('[APManager] Fehler beim Starten des Shutdown:', error.message);
    }
  }

  /**
   * Generiere neues Passwort (kann manuell aufgerufen werden)
   */
  async regeneratePassword() {
    const newPassword = generateAPPassword();
    await this.setAPPassword(newPassword);
    return newPassword;
  }
}

module.exports = APManager;
