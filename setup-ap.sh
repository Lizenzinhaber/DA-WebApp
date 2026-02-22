#!/bin/bash
# ============================================================
# DA-WebApp: Raspberry Pi Access Point Setup Script
# ============================================================
#
# Dieses Script konfiguriert den Raspberry Pi als WiFi Access Point
# mit NetworkManager. Es ist für die einmalige Ersteinrichtung gedacht.
#
# Voraussetzungen:
#   - Raspberry Pi OS mit NetworkManager (Standard bei neueren Versionen)
#   - WLAN-Interface (wlan0)
#   - USB Ethernet Gadget (usb0) für SSH-Zugang
#
# Was dieses Script macht:
#   1. Prüft Voraussetzungen (NetworkManager, wlan0, etc.)
#   2. Installiert benötigte Pakete (iw, dnsmasq falls nötig)
#   3. Konfiguriert NetworkManager für AP-Modus
#   4. Erlaubt dem App-User (chris) passwortloses sudo für shutdown & nmcli
#   5. Konfiguriert den systemd Service
#
# WICHTIG: USB Ethernet (usb0) wird NICHT angetastet!
#
# Verwendung:
#   chmod +x setup-ap.sh
#   sudo ./setup-ap.sh
#
# ============================================================

set -e

# Farben für Ausgabe
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ============================================================
# 1. Root-Prüfung
# ============================================================

if [ "$EUID" -ne 0 ]; then
    log_error "Bitte als root ausführen: sudo ./setup-ap.sh"
    exit 1
fi

APP_USER="${1:-chris}"
APP_DIR="/home/${APP_USER}/DA-WebApp"

log_info "Setup für User: ${APP_USER}, App-Dir: ${APP_DIR}"

# ============================================================
# 2. Voraussetzungen prüfen
# ============================================================

log_info "Prüfe Voraussetzungen..."

# NetworkManager
if ! systemctl is-active --quiet NetworkManager; then
    log_error "NetworkManager ist nicht aktiv! Bitte installieren/aktivieren:"
    echo "  sudo apt install network-manager"
    echo "  sudo systemctl enable --now NetworkManager"
    exit 1
fi
log_info "✓ NetworkManager aktiv"

# WLAN-Interface
if ! ip link show wlan0 &>/dev/null; then
    log_error "wlan0 Interface nicht gefunden!"
    exit 1
fi
log_info "✓ wlan0 Interface vorhanden"

# USB Ethernet (usb0) – nur Warnung wenn nicht vorhanden
if ip link show usb0 &>/dev/null; then
    log_info "✓ usb0 (USB Ethernet Gadget) vorhanden – wird NICHT verändert"
else
    log_warn "usb0 nicht gefunden – SSH-Zugang über WLAN AP möglich"
fi

# ============================================================
# 3. Pakete installieren
# ============================================================

log_info "Installiere benötigte Pakete..."

apt-get update -qq
apt-get install -y -qq iw wireless-tools >/dev/null 2>&1

log_info "✓ Pakete installiert"

# ============================================================
# 4. NetworkManager für wlan0 konfigurieren
# ============================================================

log_info "Konfiguriere NetworkManager..."

# Stelle sicher dass wlan0 von NetworkManager verwaltet wird
# und nicht von wpa_supplicant blockiert wird
if systemctl is-active --quiet wpa_supplicant; then
    log_warn "wpa_supplicant läuft – deaktiviere für wlan0 (NM übernimmt)"
    # wpa_supplicant nur für wlan0 deaktivieren, nicht komplett
    # NM managed das intern
fi

# Deaktiviere bestehende WLAN-Client-Connections auf wlan0 (nicht löschen!)
# Netplan-verwaltete Connections werden nur deaktiviert, nicht entfernt,
# damit sie bei Bedarf wieder aktiviert werden können.
EXISTING_WIFI_CONS=$(nmcli -t -f NAME,TYPE,DEVICE con show --active | grep ':wifi:wlan0' | cut -d: -f1 || true)
for con in $EXISTING_WIFI_CONS; do
    if [ "$con" != "da-hotspot" ]; then
        log_warn "Deaktiviere WLAN-Client-Connection: $con (autoconnect off)"
        nmcli con modify "$con" autoconnect no 2>/dev/null || true
        nmcli con down "$con" 2>/dev/null || true
    fi
done

# Prüfe ob da-hotspot bereits existiert
if nmcli con show "da-hotspot" &>/dev/null; then
    log_info "🔄 da-hotspot Connection existiert bereits – wird beim App-Start aktualisiert"
else
    log_info "ℹ️  da-hotspot Connection wird beim ersten App-Start automatisch erstellt"
fi

log_info "✓ NetworkManager konfiguriert"

# ============================================================
# 5. Sudoers für passwortloses shutdown & nmcli
# ============================================================

log_info "Konfiguriere sudoers für ${APP_USER}..."

SUDOERS_FILE="/etc/sudoers.d/da-webapp"

cat > "${SUDOERS_FILE}" << EOF
# DA-WebApp: Erlaubt dem App-User passwortloses sudo für:
#   - System-Shutdown (für Idle-Timeout)
#   - NetworkManager-Steuerung (für Hotspot)
${APP_USER} ALL=(ALL) NOPASSWD: /sbin/shutdown
${APP_USER} ALL=(ALL) NOPASSWD: /usr/bin/nmcli
EOF

chmod 440 "${SUDOERS_FILE}"

# Validiere sudoers-Syntax
if visudo -c -f "${SUDOERS_FILE}" &>/dev/null; then
    log_info "✓ sudoers konfiguriert"
else
    log_error "sudoers-Datei ungültig! Entferne..."
    rm -f "${SUDOERS_FILE}"
    exit 1
fi

# ============================================================
# 6. systemd Service aktualisieren
# ============================================================

log_info "Konfiguriere systemd Service..."

# Finde Node.js Pfad
# nvm wird nur in interaktiver bash geladen, daher explizit sourcen
NODE_PATH=""

# Methode 1: nvm sourcen und which node
NVM_DIR="/home/${APP_USER}/.nvm"
if [ -s "${NVM_DIR}/nvm.sh" ]; then
    NODE_PATH=$(su - ${APP_USER} -c "source ${NVM_DIR}/nvm.sh && which node" 2>/dev/null || true)
fi

# Methode 2: Direkt im nvm-Verzeichnis suchen
if [ -z "$NODE_PATH" ] || [ ! -f "$NODE_PATH" ]; then
    if [ -d "${NVM_DIR}/versions/node" ]; then
        LATEST_NODE_DIR=$(ls -1d ${NVM_DIR}/versions/node/v* 2>/dev/null | sort -V | tail -1)
        if [ -n "$LATEST_NODE_DIR" ] && [ -f "${LATEST_NODE_DIR}/bin/node" ]; then
            NODE_PATH="${LATEST_NODE_DIR}/bin/node"
        fi
    fi
fi

# Methode 3: System-Node
if [ -z "$NODE_PATH" ] || [ ! -f "$NODE_PATH" ]; then
    NODE_PATH=$(which node 2>/dev/null || true)
fi

if [ -z "$NODE_PATH" ] || [ ! -f "$NODE_PATH" ]; then
    log_error "Node.js nicht gefunden! Bitte node installieren."
    exit 1
fi

log_info "Node.js gefunden: ${NODE_PATH}"

cat > /etc/systemd/system/da-webapp.service << EOF
[Unit]
Description=DA-WebApp (Node.js Sensor Dashboard + WiFi AP)
Documentation=https://github.com/Lizenzinhaber/DA-WebApp
After=network.target NetworkManager.service mariadb.service
Wants=mariadb.service
Requires=NetworkManager.service

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
ExecStart=${NODE_PATH} src/web/server.js
Restart=on-failure
RestartSec=10
StartLimitBurst=5
StartLimitIntervalSec=60
StandardOutput=journal
StandardError=journal
SyslogIdentifier=da-webapp

# Environment
EnvironmentFile=${APP_DIR}/.env

# Sicherheit: Nur notwendige Capabilities
AmbientCapabilities=
NoNewPrivileges=false

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable da-webapp

log_info "✓ systemd Service konfiguriert und aktiviert"

# ============================================================
# 7. .env Vorlage prüfen/erstellen
# ============================================================

ENV_FILE="${APP_DIR}/.env"

if [ ! -f "$ENV_FILE" ]; then
    log_info "Erstelle .env Vorlage..."
    cat > "$ENV_FILE" << 'EOF'
# DA-WebApp Konfiguration
PORT=3000

# UART (ESP32 Verbindung)
UART_ENABLED=true
UART_PORT=/dev/ttyS0
UART_BAUD=115200

# Access Point
AP_SSID=Nullweg-Joystick
AP_IFACE=wlan0
AP_IDLE_TIMEOUT_MS=180000
AP_CHECK_INTERVAL_MS=10000

# Datenbank (MariaDB)
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=chris
DB_PASSWORD=changeme
DB_NAME=da_webapp
EOF
    chown ${APP_USER}:${APP_USER} "$ENV_FILE"
    log_info "✓ .env erstellt – bitte DB_PASSWORD anpassen!"
else
    log_info "✓ .env existiert bereits"
    
    # Prüfe ob AP-Variablen vorhanden sind, wenn nicht, anfügen
    if ! grep -q "AP_SSID" "$ENV_FILE"; then
        log_info "Füge AP-Konfiguration zu .env hinzu..."
        cat >> "$ENV_FILE" << 'EOF'

# Access Point (neu hinzugefügt)
AP_SSID=Nullweg-Joystick
AP_IFACE=wlan0
AP_IDLE_TIMEOUT_MS=180000
AP_CHECK_INTERVAL_MS=10000
EOF
    fi
fi

# ============================================================
# 8. Zusammenfassung
# ============================================================

echo ""
echo "============================================"
log_info "Setup abgeschlossen! ✅"
echo "============================================"
echo ""
echo "Nächste Schritte:"
echo ""
echo "  1. .env Datei prüfen/anpassen:"
echo "     nano ${APP_DIR}/.env"
echo ""
echo "  2. Service starten:"
echo "     sudo systemctl start da-webapp"
echo ""
echo "  3. Status prüfen:"
echo "     sudo systemctl status da-webapp"
echo "     journalctl -u da-webapp -f"
echo ""
echo "  4. Hotspot testen:"
echo "     nmcli con show da-hotspot"
echo "     iw dev wlan0 station dump"
echo ""
echo "⚠️  WICHTIG:"
echo "     - SSH über usb0 (USB Ethernet) bleibt IMMER erreichbar"
echo "     - Der Pi fährt nach 3 Min ohne WLAN-Client herunter"
echo "     - Das WLAN-Passwort wird auf dem ESP32 LCD angezeigt"
echo ""
