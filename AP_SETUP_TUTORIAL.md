# Access Point Setup Tutorial (nmcli)

## 📋 Übersicht

Dieses Tutorial leitet dich durch die manuelle Einrichtung eines WiFi Access Points auf der Raspberry Pi mittels `nmcli` (NetworkManager Command Line Interface).

**Was wird implementiert:**
- WiFi Access Point mit zufälligem 16-stelligen Passwort
- Automatische Passwort-Übertragung an ESP32 via UART
- Auto-Shutdown nach 3 Minuten ohne verbundene Clients
- Der Code ist bereits **vollständig implementiert** in der Web App — du führst nur die manuellen RPi-Schritte aus!

---

## 🛠️ Voraussetzungen

### 1. Installiere NetworkManager (falls nicht vorhanden)

```bash
sudo apt-get update
sudo apt-get install network-manager
```

### 2. Prüfe OB NetworkManager läuft

```bash
sudo systemctl status NetworkManager
```

Falls nicht aktiv:
```bash
sudo systemctl start NetworkManager
sudo systemctl enable NetworkManager
```

### 3. Verifiziere nmcli ist verfügbar

```bash
nmcli --version
```

Sollte etwas wie `1.18.4` oder höher ausgeben.

---

## 🚀 Setup der Access Point Connection

### Schritt 1: Erstelle WiFi AP Connection via nmcli

Führe diesen Befehl EINMALIG aus (auf der RPi):

```bash
sudo nmcli connection add \
  type wifi \
  ifname wlan0 \
  con-name "DA-Hotspot" \
  ssid "RPi-FSR-System"
```

**Was passiert:**
- Erstellt eine neue nmcli-Connection namens `DA-Hotspot`
- Nutzt `wlan0` Interface
- SSID ist `RPi-FSR-System` (der Name unter den WiFi-Netzwerken sichtbar)

### Schritt 2: Konfiguriere AP-Modus und Sharing

```bash
sudo nmcli connection modify "DA-Hotspot" \
  802-11-wireless.mode ap \
  802-11-wireless.band bg \
  ipv4.method shared
```

**Was passiert:**
- `802-11-wireless.mode ap` → setzt i AP-Modus (nicht Client-Modus)
- `802-11-wireless.band bg` → nutzt 2.4GHz Band (bessere Reichweite/Kompatibilität)
- `ipv4.method shared` → RPi gibt sich selbst IP via DHCP an Clients

### Schritt 3: Aktiviere WPA-Sicherheit

```bash
sudo nmcli connection modify "DA-Hotspot" \
  wifi-sec.key-mgmt wpa-psk
```

**Was passiert:**
- Aktiviert WPA-Verschlüsselung
- Die Web App wird automatisch ein 16-stelliges Passwort generieren und setzen

### Schritt 4: Aktiviere die Connection

```bash
sudo nmcli connection up "DA-Hotspot"
```

**Überprüfe Status:**

```bash
nmcli connection show "DA-Hotspot"
```

Du solltest sehen:
- `connection.autoconnect: true` oder `yes`
- `802-11-wireless.mode: ap`
- `ipv4.method: shared`

---

## 🔐 Passwort-Management (Automatisch)

### Automatische Passwort-Generierung

Wenn du die Web App startest:

```bash
cd ~/DA-WebApp
npm start
```

Die App wird **automatisch**:

1. ✅ Ein 16-stelliges Passwort generieren
2. ✅ Das Passwort in nmcli setzen via:
   ```bash
   nmcli connection modify "DA-Hotspot" wifi-sec.psk "<PASSWORD>"
   ```
3. ✅ Das Passwort an den ESP32 via UART senden (CMD 0x30)
4. ✅ Der ESP32 zeigt das Passwort am LCD Display

### Manuell ein neues Passwort setzen (falls nötig)

Falls du das Passwort manuell ändern möchtest:

```bash
# Setze ein neues Passwort (muss genau 16 Zeichen sein)
sudo nmcli connection modify "DA-Hotspot" wifi-sec.psk "MyPassword123456"

# Wende Änderung an
sudo nmcli connection up "DA-Hotspot"
```

---

## 📡 Verbindungs-Test

### 1. Prüfe ob AP aktiv ist

```bash
nmcli device show wlan0
```

Sollte anzeigen:
```
GENERAL.CONNECTION: DA-Hotspot
IP4.ADDRESS[1]: 192.168.137.1/24
```

### 2. Verbinde dich von anderem Device (PC/Telefon)

**WiFi-Netzwerk:** `RPi-FSR-System`

**Passwort:** Wird in der Web App angezeigt (oder von ESP32-LCD abgelesen)

### 3. Ping-Test nach Verbindung

Vom Client-Device:
```bash
ping 192.168.137.1
```

Sollte funktionieren wenn alles richtig ist.

### 4. Web App erreichbar?

Öffne Browser auf Client und gehe zu:
```
http://192.168.137.1:3000
```

---

## ⚙️ Konfiguration (Environment Variables)

Die Web App nimmt 4 Umgebungsvariablen:

**`.env` Datei (in Web App Wurzelverzeichnis):**

```env
# Access Point
AP_DEV_MODE=true                    # Verhindert Auto-Shutdown während Entwicklung
AP_CONNECTION_NAME=DA-Hotspot       # Name der nmcli-Connection
AP_SSID=RPi-FSR-System             # SSID-Name (optional, meist hardcoded)
```

### AP_DEV_MODE erklärt

- `AP_DEV_MODE=true` → **Shutdown deaktiviert**, große Timeout-Intervalle
- `AP_DEV_MODE=false` → **Shutdown aktiv** nach 3 Min keine Clients

**Für Produktion:**
```env
AP_DEV_MODE=false
```

**Für Entwicklung/Debugging:**
```env
AP_DEV_MODE=true
```

---

## 🛑 Auto-Shutdown (3 Minuten, keine Clients)

### Wie es funktioniert

1. Die Web App monitort alle 30 Sekunden verbundene Clients
2. Wenn **0 Clients** für `> 3 Minuten` verbunden:
   - `sudo shutdown -h now` wird aufgerufen
   - **RPi fährt herunter**

3. Wenn Client sich **neu verbindet**:
   - Timer wird zurückgesetzt
   - Kein Shutdown

### Development Mode für sichere Tests

Um versehentliche Shutdowns während Testing zu vermeiden:

```env
AP_DEV_MODE=true
```

Mit dieser Einstellung:
- ✅ AP läuft normal
- ✅ Passwort wird generiert
- ✅ UART kommuniziert mit ESP32
- ❌ **Shutdown ist deaktiviert** (für Tests sicher)

### Shutdown manuell testen

Falls du testen möchtest, ob Shutdown funktioniert:

1. Setze `AP_DEV_MODE=false`
2. Starte Web App
3. **Verbinde NICHT** mit dem AP (oder trenne dich)
4. Warte 3 Minuten
5. RPi sollte herunterfahren

> **Warnung:** Nicht in Produktion laufen lassen während du daran arbeitest!

---

## 🔧 Troubleshooting

### Problem: nmcli Connection zeigt nicht an

**Test:**
```bash
sudo nmcli connection show --active
```

**Lösung:**
```bash
sudo nmcli connection up "DA-Hotspot"
```

### Problem: Clients können sich nicht verbinden

**Check Passwort-Format:**
```bash
sudo nmcli connection show "DA-Hotspot" | grep psk
```

Sollte anzeigen: `wifi-sec.psk: <PASSWORD>`

**Regeneriere via Web App:**
- Starte die Web App neu (generiert neues Passwort)
- Oder setze manuell in `.env`:
  ```env
  AP_DEV_MODE=true
  ```

### Problem: IP-Adressen falsch

Überprüfe Subnet-Konfiguration:

```bash
sudo nmcli connection show "DA-Hotspot" | grep ipv4
```

Sollte anzeigen:
```
ipv4.method: shared
ipv4.dhcp-client-id: --
```

Falls nicht korrekt:
```bash
sudo nmcli connection modify "DA-Hotspot" ipv4.method shared
```

### Problem: Web App kriegt keine Clients-Zahl

Das ist OK! Fallback auf einfaches Timeout-System. Die Funktion `getConnectedClientCount()` versucht `iw` — wenn nicht verfügbar, setzt sie Count auf 0, und das ist akzeptabel.

---

## 📋 Checkliste für Production

- [ ] `AP_DEV_MODE=false` gesetzt
- [ ] nmcli Connection läuft: `sudo nmcli connection up "DA-Hotspot"`
- [ ] Web App gestartet: `npm start`
- [ ] ESP32 verbunden via UART `/dev/ttyS0`
- [ ] Passwort im ESP32-LCD sichtbar
- [ ] Test-Client kann sich verbinden
- [ ] Dashboard erreichbar via `http://192.168.137.1:3000`
- [ ] Nach 3 Min kein Client → RPi shutdown funktioniert

---

## 🚀 Quick Start der Web App

```bash
# Gehe zum Web App Verzeichnis
cd DA-WebApp

# Installiere Dependencies (falls nicht done)
npm install

# Starte Server
npm start
```

Logs sollten zeigen:
```
[APManager] Initialisiert: { connection: 'DA-Hotspot', ... }
[APManager] Passwort an ESP32 gesendet
📶 Access Point Manager initialized
🚀 Web server listening on http://localhost:3000
```

---

## 📚 nmcli Referenz-Befehle

```bash
# Zeige alle Connections
nmcli connection show

# Zeige Details einer Connection
nmcli connection show "DA-Hotspot"

# Aktive Connections
nmcli connection show --active

# Bringe Connection up
sudo nmcli connection up "DA-Hotspot"

# Bringe Connection down
sudo nmcli connection down "DA-Hotspot"

# Ändere Einstelling
sudo nmcli connection modify "DA-Hotspot" <key> <value>

# Lösche eine Connection
sudo nmcli connection delete "DA-Hotspot"

# Wlan-Geräte Status
nmcli device show wlan0

# Verbundene Clients (Alternative):
iw dev wlan0 station dump
```

---

## ✅ Fazit

Die meiste Arbeit ist **bereits in der Web App implementiert**. Du brauchst nur:

1. **EINMALIG:** nmcli Connection via Schritt 1-4 erstellen
2. **JEDES MAL:** Web App starten mit `npm start`
3. **OPTIONAL:** Umgebungsvariablen in `.env` anpassen

Der Rest (Passwort-Generierung, UART-Versand, Auto-Shutdown) läuft **automatisch**! 🎉
