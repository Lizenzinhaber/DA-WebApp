/**
 * @file filterPresetStore.js
 * @brief Filter-Voreinstellungen (Presets) in der Datenbank verwalten
 * 
 * Schema:
 *   filter_presets (
 *     id INT PRIMARY KEY AUTO_INCREMENT,
 *     name VARCHAR(255) UNIQUE NOT NULL,
 *     filter_type ENUM('ma', 'lpf') NOT NULL,
 *     noise_gate INT NOT NULL,
 *     fsr_max INT NOT NULL,
 *     created_by VARCHAR(255) NOT NULL,
 *     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
 *   )
 */

const { pool } = require("./connection");

/**
 * Initialisiere die filter_presets Tabelle (falls nicht existiert)
 */
async function initializeFilterPresetsTable() {
  const conn = await pool.getConnection();
  try {
    const sql = `
      CREATE TABLE IF NOT EXISTS filter_presets (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) UNIQUE NOT NULL,
        filter_type ENUM('ma', 'lpf') NOT NULL,
        noise_gate INT NOT NULL CHECK (noise_gate >= 0 AND noise_gate <= 4095),
        fsr_max INT NOT NULL CHECK (fsr_max >= 1 AND fsr_max <= 4095),
        created_by VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    
    await conn.execute(sql);
    console.log("[DB] filter_presets table initialized");
  } catch (err) {
    console.error("[DB] Error initializing filter_presets table:", err.message);
  } finally {
    conn.release();
  }
}

/**
 * Alle Presets abrufen (sortiert nach Name, neueste zuerst)
 */
async function listFilterPresets() {
  try {
    const [rows] = await pool.execute(
      `SELECT id, name, filter_type, noise_gate, fsr_max, created_by, created_at 
       FROM filter_presets 
       ORDER BY created_at DESC`
    );
    return rows || [];
  } catch (err) {
    console.error("[FilterPreset] listFilterPresets error:", err.message);
    return [];
  }
}

/**
 * Einzelnes Preset abrufen
 */
async function getFilterPreset(presetId) {
  try {
    const [rows] = await pool.execute(
      `SELECT id, name, filter_type, noise_gate, fsr_max, created_by, created_at 
       FROM filter_presets 
       WHERE id = ?`,
      [presetId]
    );
    return rows && rows.length > 0 ? rows[0] : null;
  } catch (err) {
    console.error("[FilterPreset] getFilterPreset error:", err.message);
    return null;
  }
}

/**
 * Neues Preset erstellen
 * 
 * @param {string} name - Präsetname (muss eindeutig sein)
 * @param {string} filterType - 'ma' oder 'lpf'
 * @param {number} noiseGate - 0-4095
 * @param {number} fsrMax - 1-4095
 * @param {string} createdBy - Name des Erstellers
 * @returns {Object|null} Erstelltes Preset oder null bei Fehler
 */
async function createFilterPreset(name, filterType, noiseGate, fsrMax, createdBy) {
  try {
    // Validierung
    if (!name || typeof name !== "string") {
      throw new Error("Invalid name");
    }
    if (!["ma", "lpf"].includes(filterType)) {
      throw new Error("Invalid filter_type");
    }
    
    const ng = Math.max(0, Math.min(4095, Number(noiseGate) || 0));
    const fm = Math.max(1, Math.min(4095, Number(fsrMax) || 4000));
    
    const trimmedName = name.trim();
    const trimmedCreator = (createdBy || "Unbekannt").trim();
    
    const [result] = await pool.execute(
      `INSERT INTO filter_presets (name, filter_type, noise_gate, fsr_max, created_by) 
       VALUES (?, ?, ?, ?, ?)`,
      [trimmedName, filterType, ng, fm, trimmedCreator]
    );
    
    if (result && result.insertId) {
      return {
        id: result.insertId,
        name: trimmedName,
        filter_type: filterType,
        noise_gate: ng,
        fsr_max: fm,
        created_by: trimmedCreator,
        created_at: new Date().toISOString()
      };
    }
    
    return null;
  } catch (err) {
    console.error("[FilterPreset] createFilterPreset error:", err.message);
    return null;
  }
}

/**
 * Preset aktualisieren
 */
async function updateFilterPreset(presetId, name, filterType, noiseGate, fsrMax) {
  try {
    const ng = Math.max(0, Math.min(4095, Number(noiseGate) || 0));
    const fm = Math.max(1, Math.min(4095, Number(fsrMax) || 4000));
    
    const [result] = await pool.execute(
      `UPDATE filter_presets 
       SET name = ?, filter_type = ?, noise_gate = ?, fsr_max = ? 
       WHERE id = ?`,
      [name.trim(), filterType, ng, fm, presetId]
    );
    
    return result && result.affectedRows > 0;
  } catch (err) {
    console.error("[FilterPreset] updateFilterPreset error:", err.message);
    return false;
  }
}

/**
 * Preset löschen
 */
async function deleteFilterPreset(presetId) {
  try {
    const [result] = await pool.execute(
      `DELETE FROM filter_presets WHERE id = ?`,
      [presetId]
    );
    
    return result && result.affectedRows > 0;
  } catch (err) {
    console.error("[FilterPreset] deleteFilterPreset error:", err.message);
    return false;
  }
}

module.exports = {
  initializeFilterPresetsTable,
  listFilterPresets,
  getFilterPreset,
  createFilterPreset,
  updateFilterPreset,
  deleteFilterPreset
};
