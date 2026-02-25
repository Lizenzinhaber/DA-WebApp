// src/web/routes/api.js
const express = require("express");
const crypto = require("crypto");

const { listUsers, createUser } = require("../../services/database/userStore");
const { ensureSession, getActiveUser, setActiveUser } = require("../../services/database/sessionStore");
const { listFilterPresets, getFilterPreset, createFilterPreset, updateFilterPreset, deleteFilterPreset } = require("../../services/database/filterPresetStore");

const router = express.Router();

/* ============================================================
 * Sicherheits-Hilfsfunktionen für Import
 * ============================================================ */

/** Maximal erlaubte Presets pro Import */
const MAX_IMPORT_PRESETS = 50;

/** Maximal erlaubte Stringlänge für Name/Creator */
const MAX_STRING_LENGTH = 255;

/**
 * Sanitize einen String: HTML-Tags entfernen, Länge begrenzen, Whitespace trimmen.
 * Verhindert XSS und Code-Injection.
 * @param {*} input - Roher Input
 * @param {number} maxLen - Maximale Länge
 * @returns {string|null} Sicherer String oder null bei ungültigem Input
 */
function sanitizeString(input, maxLen = MAX_STRING_LENGTH) {
  if (input === undefined || input === null) return null;
  if (typeof input !== "string") return null;

  // HTML-Tags und Script-Inhalte entfernen
  let clean = input
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/javascript:/gi, "")
    .replace(/on\w+\s*=/gi, "");

  // Steuerzeichen entfernen (außer normales Whitespace)
  clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // Trimmen und Längenbegrenzung
  clean = clean.trim().substring(0, maxLen);

  return clean || null;
}

/**
 * Validiere und sanitize ein einzelnes Preset-Objekt aus dem Import.
 * @param {*} raw - Rohes Preset-Objekt
 * @param {number} index - Index im Array (für Fehlermeldungen)
 * @returns {{ preset: Object|null, error: string|null }}
 */
function validateImportPreset(raw, index) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { preset: null, error: `[${index}] Kein gültiges Objekt` };
  }

  const has = Object.prototype.hasOwnProperty;
  if (has.call(raw, "__proto__") || has.call(raw, "constructor") || has.call(raw, "prototype")) {
    return { preset: null, error: `[${index}] Ungültige Felder (Prototype-Pollution Versuch)` };
  }

  // Name (Pflicht)
  const name = sanitizeString(raw.name);
  if (!name) {
    return { preset: null, error: `[${index}] Fehlender oder ungültiger Name` };
  }

  // Noise Gate
  const noiseGate = Number(raw.noise_gate ?? raw.noiseGate);
  if (!Number.isFinite(noiseGate) || noiseGate < 0 || noiseGate > 4095) {
    return { preset: null, error: `[${index}] "${name}": noise_gate ungültig (0-4095)` };
  }

  // FSR Max
  const fsrMax = Number(raw.fsr_max ?? raw.fsrMax);
  if (!Number.isFinite(fsrMax) || fsrMax < 1 || fsrMax > 4095) {
    return { preset: null, error: `[${index}] "${name}": fsr_max ungültig (1-4095)` };
  }

  // MA Window (optional, Default 6)
  const maWindowRaw = raw.ma_window ?? raw.maWindow;
  const maWindow = maWindowRaw !== undefined ? Number(maWindowRaw) : 6;
  if (!Number.isFinite(maWindow) || maWindow < 0 || maWindow > 20) {
    return { preset: null, error: `[${index}] "${name}": ma_window ungültig (0-20)` };
  }

  // LPF Alpha (optional, Default 0.90)
  const lpfAlphaRaw = raw.lpf_alpha ?? raw.lpfAlpha;
  const lpfAlpha = lpfAlphaRaw !== undefined ? Number(lpfAlphaRaw) : 0.90;
  if (!Number.isFinite(lpfAlpha) || lpfAlpha < 0 || lpfAlpha > 1) {
    return { preset: null, error: `[${index}] "${name}": lpf_alpha ungültig (0-1)` };
  }

  // Creator (optional, Default)
  const createdBy = sanitizeString(raw.created_by || raw.createdBy) || "Import";

  return {
    preset: {
      name,
      noiseGate: Math.floor(noiseGate),
      fsrMax: Math.floor(fsrMax),
      maWindow: Math.floor(maWindow),
      lpfAlpha: Math.round(lpfAlpha * 100) / 100,
      createdBy
    },
    error: null
  };
}

function getOrCreateSessionId(req, res) {
  let sid = req.cookies?.sid;

  if (!sid) {
    sid = crypto.randomUUID();
    res.cookie("sid", sid, { httpOnly: true, sameSite: "lax" });
  }

  return sid;
}

// --- Users ---
router.get("/users", async (req, res) => {
  const users = await listUsers();
  res.json(users);
});

router.post("/users", async (req, res) => {
  const name = (req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "name required" });

  const user = await createUser(name);
  res.json(user);
});

// --- Session / Active user ---
router.get("/session", async (req, res) => {
  const sid = getOrCreateSessionId(req, res);
  await ensureSession(sid);

  const activeUser = await getActiveUser(sid);
  res.json({ sid, activeUser: activeUser?.id ? activeUser : null });
});

router.post("/session/active-user", async (req, res) => {
  const sid = getOrCreateSessionId(req, res);

  // erlaubt: { userId: 3 } oder { userId: null }
  const userId = req.body?.userId ?? null;

  const activeUser = await setActiveUser(sid, userId);
  res.json({ sid, activeUser: activeUser?.id ? activeUser : null });
});

// --- Filter Presets ---
router.get("/filter-presets", async (req, res) => {
  const presets = await listFilterPresets();
  res.json(presets);
});

// WICHTIG: Export/Import Routen MÜSSEN vor :id Route stehen,
// sonst matcht Express "export" als :id Parameter!

// --- Filter Presets Export ---
router.get("/filter-presets/export", async (req, res) => {
  try {
    const presets = await listFilterPresets();

    const exportData = {
      version: 2,
      exportedAt: new Date().toISOString(),
      presets: presets.map(p => ({
        name: p.name,
        noise_gate: p.noise_gate,
        fsr_max: p.fsr_max,
        ma_window: p.ma_window,
        lpf_alpha: Number(p.lpf_alpha),
        created_by: p.created_by
      }))
    };

    const filename = `filter-presets_${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.json(exportData);
  } catch (err) {
    console.error("[API] Export error:", err.message);
    res.status(500).json({ error: "Export fehlgeschlagen" });
  }
});

// --- Filter Presets Import ---
router.post("/filter-presets/import", async (req, res) => {
  try {
    const body = req.body;

    if (!body || typeof body !== "object") {
      return res.status(400).json({ error: "Ungültiges JSON" });
    }

    const has = Object.prototype.hasOwnProperty;
    if (has.call(body, "__proto__") || has.call(body, "constructor") || has.call(body, "prototype")) {
      return res.status(400).json({ error: "Ungültige Felder erkannt" });
    }

    let rawPresets;
    if (Array.isArray(body)) {
      rawPresets = body;
    } else if (body.presets && Array.isArray(body.presets)) {
      rawPresets = body.presets;
    } else {
      return res.status(400).json({ error: "Kein 'presets' Array gefunden" });
    }

    if (rawPresets.length === 0) {
      return res.status(400).json({ error: "Leeres Preset-Array" });
    }
    if (rawPresets.length > MAX_IMPORT_PRESETS) {
      return res.status(400).json({ error: `Maximal ${MAX_IMPORT_PRESETS} Presets pro Import erlaubt` });
    }

    const results = { imported: [], skipped: [], errors: [] };

    for (let i = 0; i < rawPresets.length; i++) {
      const { preset, error } = validateImportPreset(rawPresets[i], i);

      if (error) {
        results.errors.push(error);
        continue;
      }

      try {
        const created = await createFilterPreset(
          preset.name,
          preset.noiseGate,
          preset.fsrMax,
          preset.maWindow,
          preset.lpfAlpha,
          preset.createdBy
        );

        if (created) {
          results.imported.push(preset.name);
        } else {
          results.skipped.push(`"${preset.name}" (existiert bereits oder DB-Fehler)`);
        }
      } catch (dbErr) {
        results.skipped.push(`"${preset.name}" (${dbErr.message})`);
      }
    }

    res.json({
      success: true,
      summary: {
        total: rawPresets.length,
        imported: results.imported.length,
        skipped: results.skipped.length,
        errors: results.errors.length
      },
      imported: results.imported,
      skipped: results.skipped,
      errors: results.errors
    });
  } catch (err) {
    console.error("[API] Import error:", err.message);
    res.status(500).json({ error: "Import fehlgeschlagen: " + err.message });
  }
});

router.get("/filter-presets/:id", async (req, res) => {
  const preset = await getFilterPreset(Number(req.params.id));
  if (!preset) {
    return res.status(404).json({ error: "Preset not found" });
  }
  res.json(preset);
});

router.post("/filter-presets", async (req, res) => {
  const { name, noiseGate, fsrMax, maWindow, lpfAlpha, createdBy } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: "name required" });
  }
  
  const preset = await createFilterPreset(name, noiseGate, fsrMax, maWindow, lpfAlpha, createdBy);
  if (!preset) {
    return res.status(400).json({ error: "Failed to create preset" });
  }
  
  res.json(preset);
});

router.put("/filter-presets/:id", async (req, res) => {
  const { name, noiseGate, fsrMax, maWindow, lpfAlpha } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: "name required" });
  }
  
  const ok = await updateFilterPreset(Number(req.params.id), name, noiseGate, fsrMax, maWindow, lpfAlpha);
  if (!ok) {
    return res.status(400).json({ error: "Failed to update preset" });
  }
  
  const preset = await getFilterPreset(Number(req.params.id));
  res.json(preset);
});

router.delete("/filter-presets/:id", async (req, res) => {
  const ok = await deleteFilterPreset(Number(req.params.id));
  if (!ok) {
    return res.status(400).json({ error: "Failed to delete preset" });
  }
  
  res.json({ success: true });
});

module.exports = router;
