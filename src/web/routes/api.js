// src/web/routes/api.js
const express = require("express");
const crypto = require("crypto");

const { listUsers, createUser } = require("../../services/database/userStore");
const { ensureSession, getActiveUser, setActiveUser } = require("../../services/database/sessionStore");

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

module.exports = router;
