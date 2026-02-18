/**
 * @file index.js (UART Services)
 * @brief Export-Aggregator für UART-Kommunikations-Schichten
 */

module.exports = {
  UARTClient: require("./uartClient").UARTClient,
  UARTSource: require("./uartSource").UARTSource,
  UARTFrameParser: require("./uartFrameParser").UARTFrameParser,
  protocol: require("./uartProtocol")
};
