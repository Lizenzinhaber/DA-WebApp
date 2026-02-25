/**
 * @file filterPresetStore.js
 * @brief Filter-Voreinstellungen (Presets) in der Datenbank verwalten
 * 
 * Schema:
 *   filter_presets (
 *     id INT PRIMARY KEY AUTO_INCREMENT,
 *     name VARCHAR(255) UNIQUE NOT NULL,
 *     noise_gate INT NOT NULL,
 *     fsr_max INT NOT NULL,
 *     ma_window TINYINT UNSIGNED NOT NULL DEFAULT 6,
 *     lpf_alpha DECIMAL(3,2) NOT NULL DEFAULT 0.90,
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
    const createSql = `
      CREATE TABLE IF NOT EXISTS filter_presets (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) UNIQUE NOT NULL,
        noise_gate INT NOT NULL CHECK (noise_gate >= 0 AND noise_gate <= 4095),
        fsr_max INT NOT NULL CHECK (fsr_max >= 1 AND fsr_max <= 4095),
        ma_window TINYINT UNSIGNED NOT NULL DEFAULT 6,
        lpf_alpha DECIMAL(3,2) NOT NULL DEFAULT 0.90,
        created_by VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    await conn.execute(createSql);

    // Migration: alte Tabelle ohne ma_window/lpf_alpha -> Spalten nachrüsten
    const [cols] = await conn.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'filter_presets'`
    );
    const colNames = cols.map(c => c.COLUMN_NAME || c.column_name);

    if (!colNames.includes("ma_window")) {
      await conn.execute(
        `ALTER TABLE filter_presets ADD COLUMN ma_window TINYINT UNSIGNED NOT NULL DEFAULT 6`
      );
    }
    if (!colNames.includes("lpf_alpha")) {
      await conn.execute(
        `ALTER TABLE filter_presets ADD COLUMN lpf_alpha DECIMAL(3,2) NOT NULL DEFAULT 0.90`
      );
    }

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
      `SELECT id, name, noise_gate, fsr_max, ma_window, lpf_alpha, created_by, created_at 
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
      `SELECT id, name, noise_gate, fsr_max, ma_window, lpf_alpha, created_by, created_at 
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
 * @param {number} noiseGate - 0-4095
 * @param {number} fsrMax - 1-4095
 * @param {number} maWindow - 0-20 (MA Fenstergröße)
 * @param {number} lpfAlpha - 0.00-1.00 (LPF Glättungsfaktor)
 * @param {string} createdBy - Name des Erstellers
 * @returns {Object|null} Erstelltes Preset oder null bei Fehler
 */
async function createFilterPreset(name, noiseGate, fsrMax, maWindow, lpfAlpha, createdBy) {
  try {
    if (!name || typeof name !== "string") {
      throw new Error("Invalid name");
    }
    
    const ng  = Math.max(0, Math.min(4095, Number(noiseGate) || 0));
    const fm  = Math.max(1, Math.min(4095, Number(fsrMax) || 4000));
    const mw  = Math.max(0, Math.min(20, Math.floor(Number(maWindow) ?? 6)));
    const la  = Math.max(0, Math.min(1, Number(lpfAlpha) ?? 0.90));
    
    const trimmedName = name.trim();
    const trimmedCreator = (createdBy || "Unbekannt").trim();
    
    const [result] = await pool.execute(
      `INSERT INTO filter_presets (name, noise_gate, fsr_max, ma_window, lpf_alpha, created_by) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [trimmedName, ng, fm, mw, la, trimmedCreator]
    );
    
    if (result && result.insertId) {
      return {
        id: result.insertId,
        name: trimmedName,
        noise_gate: ng,
        fsr_max: fm,
        ma_window: mw,
        lpf_alpha: la,
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
async function updateFilterPreset(presetId, name, noiseGate, fsrMax, maWindow, lpfAlpha) {
  try {
    const ng  = Math.max(0, Math.min(4095, Number(noiseGate) || 0));
    const fm  = Math.max(1, Math.min(4095, Number(fsrMax) || 4000));
    const mw  = Math.max(0, Math.min(20, Math.floor(Number(maWindow) ?? 6)));
    const la  = Math.max(0, Math.min(1, Number(lpfAlpha) ?? 0.90));
    
    const [result] = await pool.execute(
      `UPDATE filter_presets 
       SET name = ?, noise_gate = ?, fsr_max = ?, ma_window = ?, lpf_alpha = ? 
       WHERE id = ?`,
      [name.trim(), ng, fm, mw, la, presetId]
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
