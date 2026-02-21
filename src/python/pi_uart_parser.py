#!/usr/bin/env python3
import serial
import time

# UART Einstellungen
PORT = "/dev/ttyAMA0"
BAUD = 115200
TIMEOUT = 0.1  # Sekunden

# Protokoll
START_BYTE = 0xAA
STOP_BYTE  = 0x55

# CRC-8 (Poly 0x07, Initial 0x00)
def crc8(data: bytes) -> int:
    crc = 0x00
    for b in data:
        crc ^= b
        for _ in range(8):
            if crc & 0x80:
                crc = ((crc << 1) ^ 0x07) & 0xFF
            else:
                crc = (crc << 1) & 0xFF
    return crc

# Hex-Ausgabe
def print_hex(label: str, data: bytes):
    print(f"{label}: {' '.join(f'{b:02X}' for b in data)}")

# UART öffnen
ser = serial.Serial(PORT, BAUD, timeout=TIMEOUT)
print(f"Listening on {PORT} @ {BAUD} baud...")

buffer = bytearray()

try:
    while True:
        # Neue Bytes lesen
        data = ser.read(64)  # liest bis zu 64 Bytes
        if not data:
            continue
        buffer.extend(data)

        # Frame Parsing: Suche Start-Byte
        while True:
            if START_BYTE in buffer:
                start_idx = buffer.index(START_BYTE)
                # Entferne alles vor Start-Byte
                if start_idx > 0:
                    buffer = buffer[start_idx:]
            else:
                # kein Start-Byte vorhanden -> alles verwerfen
                buffer.clear()
                break

            # Minimum Frame-Länge prüfen: start + type + length + crc + stop
            if len(buffer) < 5:
                break  # noch nicht genug Daten

            # Payload-Länge lesen
            payload_len = buffer[2]  # Byte 2 = PayloadLength
            frame_len = 1 + 1 + 1 + payload_len + 1 + 1  # start + type + len + payload + crc + stop

            if len(buffer) < frame_len:
                break  # noch nicht komplett

            frame = buffer[:frame_len]

            # Prüfe Stop-Byte
            if frame[-1] != STOP_BYTE:
                print("Invalid frame: Stop byte mismatch")
                # Entferne Start-Byte und suche weiter
                buffer = buffer[1:]
                continue

            # Prüfe CRC
            crc_data = frame[1:-2]  # type + len + payload
            calc_crc = crc8(crc_data)
            frame_crc = frame[-2]
            if calc_crc != frame_crc:
                print_hex("Frame", frame)
                print(f"Invalid CRC: calculated {calc_crc:02X}, received {frame_crc:02X}")
            else:
                # Gültiger Frame
                msg_type = frame[1]
                payload = frame[3:-2]
                print_hex("Frame", frame)
                print(f"MsgType: {msg_type:02X}, Payload: {' '.join(f'{b:02X}' for b in payload)}")
                print("-" * 50)

            # Entferne verarbeitete Bytes
            buffer = buffer[frame_len:]
except KeyboardInterrupt:
    print("\nExiting...")
    ser.close()
