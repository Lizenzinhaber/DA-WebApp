// src/services/database/userStore.js
const { pool } = require("./connection");

async function listUsers() {
  const [rows] = await pool.execute(
    "SELECT id, name, created_at FROM users ORDER BY name ASC"
  );
  return rows;
}

async function createUser(name) {
  const [res] = await pool.execute(
    "INSERT INTO users(name) VALUES (?)",
    [name]
  );
  const [rows] = await pool.execute(
    "SELECT id, name, created_at FROM users WHERE id = ?",
    [res.insertId]
  );
  return rows[0];
}

module.exports = { listUsers, createUser };
