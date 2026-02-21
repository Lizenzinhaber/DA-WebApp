// src/web/routes/api.js
const express = require("express");
const crypto = require("crypto");

const { listUsers, createUser } = require("../../services/database/userStore");
const { ensureSession, getActiveUser, setActiveUser } = require("../../services/database/sessionStore");
const { listFilterPresets, getFilterPreset, createFilterPreset, updateFilterPreset, deleteFilterPreset } = require("../../services/database/filterPresetStore");

const router = express.Router();

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

router.get("/filter-presets/:id", async (req, res) => {
  const preset = await getFilterPreset(Number(req.params.id));
  if (!preset) {
    return res.status(404).json({ error: "Preset not found" });
  }
  res.json(preset);
});

router.post("/filter-presets", async (req, res) => {
  const { name, filterType, noiseGate, fsrMax, createdBy } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: "name required" });
  }
  
  const preset = await createFilterPreset(name, filterType, noiseGate, fsrMax, createdBy);
  if (!preset) {
    return res.status(400).json({ error: "Failed to create preset" });
  }
  
  res.json(preset);
});

router.put("/filter-presets/:id", async (req, res) => {
  const { name, filterType, noiseGate, fsrMax } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: "name required" });
  }
  
  const ok = await updateFilterPreset(Number(req.params.id), name, filterType, noiseGate, fsrMax);
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
