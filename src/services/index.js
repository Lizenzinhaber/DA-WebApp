/**
 * @file index.js (Services)
 * @brief Export-Aggregator für alle Service-Module
 */

module.exports = {
  // UART Services
  uart: require("./uart"),
  
  // Processing Services
  processing: {
    SensorProcessor: require("./processing/sensorProcessor").SensorProcessor
  },
  
  // Simulation Services
  simulation: {
    SimulationSource: require("./simulation/simulationSource").SimulationSource
  }
};
