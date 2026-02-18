# 🚀 QUICK START: UART Integration Da-WebApp

## 5-Minuten Setup

### 1. **Überprüfe Voraussetzungen**
```bash
# Node.js Version
node --version          # mind. v16

# Raspberry Pi GPIO Available?
ls -la /dev/ttyAMA0     # sollte existieren
```

### 2. **Installiere Abhängigkeiten**
```bash
cd ~/Documents/HTL/DA/VSCode_SFTP/DA-WebApp

# serialport sollte bereits installiert sein
npm list serialport
```

### 3. **Konfiguriere Umgebung**

**Datei: `.env`**
```bash
# Für echten UART (Raspberry Pi)
UART_ENABLED=true
UART_PORT=/dev/ttyAMA0
UART_BAUD=115200
PORT=3000

# DB-Zugang (aus bestehender .env)
DB_HOST=127.0.0.1
DB_USER=da_app
DB_PASSWORD=DiplomArbeit2025
DB_NAME=da_webapp
```

**Für Tests (Simulation):**
```bash
UART_ENABLED=false
PORT=3000
```

### 4. **Starte Web-Server**

```bash
# Mit UART (Echtdaten vom ESP32)
npm start

# Output sollte zeigen:
# [UART] ✅ Connected to /dev/ttyAMA0 @ 115200 baud
# 🚀 Web server listening on http://localhost:3000
```

### 5. **Öffne Web-Browser**
```
http://localhost:3000
```

---

## 🔍 Mit Simulation Testen

Falls ESP32 nicht verbunden:

```bash
export UART_ENABLED=false
npm start

# Output:
# 🎬 Using Simulation as data source
# ✅ Data source started (Simulation)
# 🚀 Web server listening on http://localhost:3000
```

---

## 📊 Live-Debugging

### Terminal 1: Web-Server
```bash
npm start
```

### Terminal 2: UART Monitor
```bash
# Alle seriellen Ports anschauen
tio -L

# Verbinde dich mit dem Port
tio /dev/ttyAMA0

# ODER mit minicom
minicom -D /dev/ttyAMA0 -b 115200

# ODER mit screen
screen /dev/ttyAMA0 115200
```

### Terminal 3: Socket.IO Debug
```bash
# Mit curl oder wscat
npm install -g wscat

wscat -c ws://localhost:3000
# Sollte Daten-Events zeigen
```

---

## ✅ Checkliste Vor Produktivbetrieb

- [ ] UART-Port funktioniert (`tio /dev/ttyAMA0`)
- [ ] CRC-Fehler im Log sind < 1% (`errorRate` in Status)
- [ ] Web-Client zeigt kontinuierliche Daten
- [ ] GPIO14 (TX) und GPIO15 (RX) sind verbunden
- [ ] ESP32 sendet mit 115200 baud
- [ ] Datenbank ist erreichbar
- [ ] `.env` ist konfiguriert

---

## 🐛 Häufige Probleme

### ❌ "Port not found: /dev/ttyAMA0"

**Lösung:**
1. Überprüfe RPi Serial-Interface ist aktiviert:
   ```bash
   sudo raspi-config → Interface Options → Serial Port
   ```
2. Überprüfe Baudrate (sollte 115200 sein):
   ```bash
   stty -F /dev/ttyAMA0
   ```

### ❌ "CRC mismatch" Fehler

**Lösung:**
- Überprüfe Kabel (GPIO14 ↔ RX, GPIO15 ↔ TX)
- Überprüfe Baudrate auf ESP32 (muss 115200 sein)
- Versuche Daten mit `tio` abzulesen, sollte lesbar sein

### ❌ Keine Daten vom ESP32

**Lösung:**
1. Überprüfe ob ESP32 Code lädt (`uart_protocol.cpp`)
2. Überprüfe ob FSR-Sensoren angeschlossen sind
3. Überprüfe ESP32 Baud-Einstellung:
   ```cpp
   Serial.begin(115200);  // Muss 115200 sein!
   ```
4. Überprüfe Kabel-Verkabelung 5x

### ❌ Server startet aber keine Daten

**Lösung:**
- Prüfe Console auf Fehler
- Prüfe Browser-Console (WebSocket Status)
- Aktiviere Logging in `uartSource.js` (schon aktiviert)
- Verwende Simulation zum Testen:
  ```bash
  export UART_ENABLED=false && npm start
  ```

---

## 📡 Datenfluss-Visualisierung

```
┌─────────────────────────────────────────────┐
│          ESP32 mit FSR-Sensoren             │
│  (GPIO18 RX ←→ GPIO17 TX)                   │
└────────────────────┬────────────────────────┘
                     │ 115200 baud
                     │ [0xAA][0x01]...[0x55]
                     ▼
┌─────────────────────────────────────────────┐
│     Raspberry Pi GPIO14/15 (UART0)          │
│     /dev/ttyAMA0 @ 115200 baud              │
└────────────────────┬────────────────────────┘
                     │
                     ▼
         ┌──────────────────────┐
         │  UARTFrameParser     │
         │  (State Machine)     │
         └──────────┬───────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │   UARTClient         │
         │   (CRC Check)        │
         └──────────┬───────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │   UARTSource         │
         │   (Normalisierung)   │
         └──────────┬───────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │  SensorProcessor     │
         │  (Skalierung)        │
         └──────────┬───────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │   Socket.IO          │
         │   WebSocket Events   │
         └──────────┬───────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │  Web-Browser         │
         │  (Echtzeitdaten)     │
         └──────────────────────┘
```

---

## 📚 Weitere Ressourcen

- **Vollständige Dokumentation:** [UART_DOCUMENTATION.md](./UART_DOCUMENTATION.md)
- **ESP32 Protokoll-Definition:** [../DA_CODE_ESP_5/DA_CODE_ESP/src/drivers/uart_protocol.h]()
- **Socket.IO Dokumentation:** https://socket.io/

---

## 💡 Tipps

1. **Für Entwicklung:** Nutze `UART_ENABLED=false` mit Simulation
2. **Für Debugging:** Aktiviere Logging in `uartClient.js` und `uartSource.js`
3. **Für Performance:** `emitInterval` in `UARTSource` kann Rate-Limiting machen
4. **Für Sicherheit:** Nutze TLS und Authentifizierung für Produktivbetrieb

---

**Status:** Ready for Deployment ✅
