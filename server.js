/* Aurea — petit serveur local, données sur Neon (Postgres). */
require("dotenv").config();
const crypto = require("crypto");
const { execSync, spawn } = require("child_process");
const express = require("express");
const { Pool } = require("pg");

const PORT = Number(process.env.PORT) || 3847;
const rawUrl = process.env.DATABASE_URL || "";
if (!rawUrl) {
  console.error("Manque DATABASE_URL dans le fichier .env");
  process.exit(1);
}

const connectionString = rawUrl
  .replace(/&channel_binding=require/g, "")
  .replace(/\?channel_binding=require&/g, "?")
  .replace(/\?channel_binding=require$/g, "");

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: true }
});

function hashPassword(password, salt) {
  return crypto.createHash("sha256").update(salt + "\0" + String(password), "utf8").digest("hex");
}

function newToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_data (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function userFromReq(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  await pool.query("DELETE FROM sessions WHERE expires_at < NOW()");
  const { rows } = await pool.query(
    "SELECT user_id FROM sessions WHERE token = $1 AND expires_at > NOW()",
    [token]
  );
  return rows[0] ? rows[0].user_id : null;
}

async function makeSession(userId) {
  const token = newToken();
  await pool.query(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '7 days')",
    [token, userId]
  );
  return token;
}

const app = express();
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "4mb" }));
app.use((req, res, next) => {
  const p = (req.path || "").toLowerCase();
  if (p === "/.env" || p.endsWith(".env") || p === "/server.js" || p.startsWith("/node_modules")) {
    return res.sendStatus(404);
  }
  next();
});
app.use(express.static(__dirname));

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Base injoignable" });
  }
});

app.get("/api/users", async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, name, created_at FROM users ORDER BY created_at");
    res.json(rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at })));
  } catch (err) {
    res.status(500).json({ error: "Impossible de lire les espaces" });
  }
});

app.post("/api/register", async (req, res) => {
  try {
    const name = String((req.body && req.body.name) || "").trim();
    const password = String((req.body && req.body.password) || "");
    if (!name) return res.status(400).json({ error: "Indique un prénom." });
    if (password.length < 4) return res.status(400).json({ error: "Le mot de passe doit faire au moins 4 caractères." });
    const id = "usr-" + (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"));
    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = hashPassword(password, salt);
    const payload = req.body && req.body.payload && typeof req.body.payload === "object" ? req.body.payload : {};
    await pool.query(
      "INSERT INTO users (id, name, salt, password_hash) VALUES ($1, $2, $3, $4)",
      [id, name, salt, passwordHash]
    );
    await pool.query(
      "INSERT INTO user_data (user_id, payload) VALUES ($1, $2::jsonb)",
      [id, JSON.stringify(payload)]
    );
    const token = await makeSession(id);
    res.json({ token, profile: { id, name } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Création impossible" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const id = String((req.body && req.body.id) || "");
    const password = String((req.body && req.body.password) || "");
    const { rows } = await pool.query("SELECT id, name, salt, password_hash FROM users WHERE id = $1", [id]);
    const user = rows[0];
    if (!user || hashPassword(password, user.salt) !== user.password_hash) {
      return res.status(401).json({ error: "Mot de passe incorrect." });
    }
    const token = await makeSession(user.id);
    const data = await pool.query("SELECT payload FROM user_data WHERE user_id = $1", [user.id]);
    res.json({
      token,
      profile: { id: user.id, name: user.name },
      payload: (data.rows[0] && data.rows[0].payload) || {}
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Connexion impossible" });
  }
});

app.post("/api/logout", async (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token) await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
  res.json({ ok: true });
});

app.post("/api/migrate", async (req, res) => {
  try {
    const count = await pool.query("SELECT COUNT(*)::int AS n FROM users");
    if (count.rows[0].n > 0) return res.json({ ok: true, migrated: 0 });
    const profiles = (req.body && req.body.profiles) || [];
    const blobs = (req.body && req.body.data) || {};
    let n = 0;
    for (const p of profiles) {
      if (!p || !p.id || !p.name || !p.salt || !p.passwordHash) continue;
      await pool.query(
        "INSERT INTO users (id, name, salt, password_hash) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
        [p.id, p.name, p.salt, p.passwordHash]
      );
      await pool.query(
        "INSERT INTO user_data (user_id, payload) VALUES ($1, $2::jsonb) ON CONFLICT (user_id) DO NOTHING",
        [p.id, JSON.stringify(blobs[p.id] || {})]
      );
      n += 1;
    }
    res.json({ ok: true, migrated: n });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Migration impossible" });
  }
});

app.get("/api/data", async (req, res) => {
  try {
    const userId = await userFromReq(req);
    if (!userId) return res.status(401).json({ error: "Verrouillé" });
    const { rows } = await pool.query("SELECT payload FROM user_data WHERE user_id = $1", [userId]);
    res.json((rows[0] && rows[0].payload) || {});
  } catch (err) {
    res.status(500).json({ error: "Lecture impossible" });
  }
});

app.put("/api/data", async (req, res) => {
  try {
    const userId = await userFromReq(req);
    if (!userId) return res.status(401).json({ error: "Verrouillé" });
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    await pool.query(
      "INSERT INTO user_data (user_id, payload, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (user_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()",
      [userId, JSON.stringify(payload)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Enregistrement impossible" });
  }
});

app.post("/api/password", async (req, res) => {
  try {
    const userId = await userFromReq(req);
    if (!userId) return res.status(401).json({ error: "Verrouillé" });
    const current = String((req.body && req.body.current) || "");
    const next = String((req.body && req.body.next) || "");
    if (next.length < 4) return res.status(400).json({ error: "Le nouveau mot de passe doit faire au moins 4 caractères." });
    const { rows } = await pool.query("SELECT salt, password_hash FROM users WHERE id = $1", [userId]);
    const user = rows[0];
    if (!user || hashPassword(current, user.salt) !== user.password_hash) {
      return res.status(400).json({ error: "Mot de passe actuel incorrect." });
    }
    const salt = crypto.randomBytes(16).toString("hex");
    await pool.query("UPDATE users SET salt = $1, password_hash = $2 WHERE id = $3", [salt, hashPassword(next, salt), userId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Changement impossible" });
  }
});

app.post("/api/rename", async (req, res) => {
  try {
    const userId = await userFromReq(req);
    if (!userId) return res.status(401).json({ error: "Verrouillé" });
    const name = String((req.body && req.body.name) || "").trim();
    if (!name) return res.status(400).json({ error: "Prénom vide" });
    await pool.query("UPDATE users SET name = $1 WHERE id = $2", [name, userId]);
    res.json({ ok: true, name });
  } catch (err) {
    res.status(500).json({ error: "Renommage impossible" });
  }
});

initDb()
  .then(async () => {
    const old = pidsOnPort(PORT);
    if (old.length) {
      freePort(PORT);
      await new Promise((r) => setTimeout(r, 400));
    }
    const url = "http://127.0.0.1:" + PORT;
    const server = app.listen(PORT, "127.0.0.1", () => {
      console.log("Aurea est prêt → " + url);
      console.log("Laisse cette fenêtre ouverte. Ferme-la pour quitter.");
      openBrowser(url);
    });
    server.on("error", (err) => {
      console.error("Impossible de lancer Aurea :", err.message);
      process.exit(1);
    });
  })
  .catch((err) => {
    console.error("Impossible de joindre Neon :", err.message);
    process.exit(1);
  });

function pidsOnPort(port) {
  try {
    const out = execSync("netstat -ano -p tcp", { encoding: "utf8" });
    const pids = new Set();
    out.split(/\r?\n/).forEach((line) => {
      if (!/LISTENING/i.test(line)) return;
      if (!line.includes(":" + port)) return;
      const parts = line.trim().split(/\s+/);
      const local = parts[1] || "";
      if (!local.endsWith(":" + port)) return;
      const pid = parts[parts.length - 1];
      if (pid && pid !== "0" && pid !== String(process.pid)) pids.add(pid);
    });
    return [...pids];
  } catch (err) {
    return [];
  }
}

function freePort(port) {
  pidsOnPort(port).forEach((pid) => {
    try { execSync("taskkill /PID " + pid + " /F", { stdio: "ignore" }); } catch (err) {}
  });
}

function openBrowser(url) {
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch (err) {}
}
