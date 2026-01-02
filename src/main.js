// src/main.js
require("./config/dotenv"); // falls vorhanden
const { createWebServer } = require("./web/server");

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
createWebServer({ port });
