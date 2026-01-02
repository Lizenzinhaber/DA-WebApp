#include <Arduino.h>

unsigned long time_now = 0;

// Forward-Deklaration
void smartDelay(unsigned long ms);

// Einstellungen
static const uint8_t START_BYTE = 0xAA;
static const uint8_t STOP_BYTE  = 0x55;

// CRC-8 (Poly 0x07, Initial 0x00)
uint8_t crc8(const uint8_t *data, size_t len) {
    uint8_t crc = 0x00;
    for (size_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (uint8_t j = 0; j < 8; j++) {
            if (crc & 0x80)
                crc = (crc << 1) ^ 0x07;
            else
                crc <<= 1;
        }
    }
    return crc;
}

void setup() {
    Serial.begin(115200);
    // Serial1: GPIO17 (TX), GPIO18 (RX) @ 115200 Baud
    Serial1.begin(115200, SERIAL_8N1, 18, 17);
    time_now = millis();
  }
  
  void loop() {
    uint16_t sensorValues[4];

    // 4 Sensordaten simulieren (0..5000)
    for (int i = 0; i < 4; i++) {
        sensorValues[i] = random(0, 5000);
    }

    uint8_t msgType = 0x01; // SensorData
    uint8_t payloadLength = 8; // 4 × uint16_t = 8 Bytes

    // Payload zusammenbauen: 4 × uint16_t, Big-Endian (High-Byte first)
    uint8_t payload[8];
    for (int i = 0; i < 4; i++) {
        payload[i * 2]     = (sensorValues[i] >> 8) & 0xFF;  // High-Byte
        payload[i * 2 + 1] = sensorValues[i] & 0xFF;         // Low-Byte
    }

    // CRC über: msgType (1) + payloadLength (1) + payload (8) = 10 Bytes
    uint8_t crcData[10];
    crcData[0] = msgType;
    crcData[1] = payloadLength;
    memcpy(&crcData[2], payload, 8);
    uint8_t crc = crc8(crcData, 10);

    // Nachricht senden: START + msgType + payloadLength + payload + CRC + STOP
    Serial1.write(START_BYTE);
    Serial.write(START_BYTE);

    Serial1.write(msgType);
    Serial.write(msgType);

    Serial1.write(payloadLength);
    Serial.write(payloadLength);

    Serial1.write(payload, 8);
    Serial.write(payload, 8);

    Serial1.write(crc);
    Serial.write(crc);

    Serial1.write(STOP_BYTE);
    Serial.write(STOP_BYTE);

    smartDelay(1000);
}

// smartDelay: nicht-blockierender Delay mit millis()
// Übergabeparameter: Millisekunden (unsigned long)
void smartDelay(unsigned long ms) {
    unsigned long start = millis();
    while (millis() - start < ms) {
        // Hintergrund-Tasks: eingehende Daten lesen (Buffer-Überläufe vermeiden)
        while (Serial.available()) {
            Serial1.write((uint8_t)Serial.read());
        }
        while (Serial1.available()) {
            Serial.write((uint8_t)Serial1.read());
        }
        yield();  // ESP/Arduino: gibt Zeit für Hintergrund-Tasks frei
    }
}
