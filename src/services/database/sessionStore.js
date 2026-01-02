// src/services/database/sessionStore.js
const { pool } = require("./connection");

async function ensureSession(sessionId) {
  await pool.execute(
    "INSERT IGNORE INTO sessions(id) VALUES (?)",
    [sessionId]
  );
}

async function getActiveUser(sessionId) {
  const [rows] = await pool.execute(
    `SELECT u.id, u.name
     FROM sessions s
     LEFT JOIN users u ON u.id = s.active_user_id
     WHERE s.id = ?`,
    [sessionId]
  );
  return rows[0] || null;
}

async function setActiveUser(sessionId, userIdOrNull) {
  await ensureSession(sessionId);

  await pool.execute(
    "UPDATE sessions SET active_user_id = ? WHERE id = ?",
    [userIdOrNull, sessionId]
  );

  return getActiveUser(sessionId);
}

module.exports = { ensureSession, getActiveUser, setActiveUser };
