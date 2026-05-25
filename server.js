"use strict";

const express = require("express");
const { Pool } = require("pg");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

const R2_BUCKET = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

const app = express();
app.use(express.json({ limit: "35mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function nowIso() { return new Date().toISOString(); }

function hashPassword(password, salt) {
  return crypto.createHash("sha256").update(`${salt}:${password}`).digest("hex");
}

function formatReportCode(number) {
  return `Pedido de Reembolso ${String(number).padStart(2, "0")}`;
}

function normalizeMoney(value) {
  if (typeof value === "number") return value;
  const text = String(value || "").trim().replace(/\./g, "").replace(",", ".");
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header.split(";")
      .map(item => item.trim().split("="))
      .filter(item => item.length === 2)
      .map(([k, v]) => [k, decodeURIComponent(v)])
  );
}

function sessionCookie(token, maxAge) {
  return [`session=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`].join("; ");
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, username: user.username, name: user.name, role: user.role, must_change_password: user.must_change_password };
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------
async function getSessionUser(req) {
  const auth = req.headers.authorization || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const token = bearer || parseCookies(req).session;
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.name, u.role, u.must_change_password
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > NOW() AND u.active = true`,
    [token]
  );
  return rows[0] || null;
}

async function requireUser(req, res, next) {
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: "Faca login para continuar." });
  req.user = user;
  next();
}

async function requireAdmin(req, res, next) {
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: "Faca login para continuar." });
  if (user.role !== "admin") return res.status(403).json({ error: "Acesso restrito ao administrador." });
  req.user = user;
  next();
}

// ---------------------------------------------------------------------------
// R2 upload
// ---------------------------------------------------------------------------
async function uploadToR2(dataUrl) {
  if (!dataUrl) return null;
  const match = /^data:(image\/(png|jpeg|jpg|webp|heic|heif)|application\/pdf);base64,(.+)$/i.exec(dataUrl);
  if (!match) throw new Error("Envie uma imagem PNG, JPG, WebP, HEIC ou PDF.");
  const mimeType = match[1].toLowerCase();
  const ext = mimeType === "application/pdf" ? "pdf" : match[2].toLowerCase() === "jpeg" ? "jpg" : match[2].toLowerCase();
  const filename = `uploads/${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
  const buffer = Buffer.from(match[3], "base64");
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: filename, Body: buffer, ContentType: mimeType }));
  return `${R2_PUBLIC_URL}/${filename}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
function validateExpense(payload, user) {
  const required = [["supplier","fornecedor"],["date","data"],["amount","valor"],["project","obra"],["company","empresa"],["description","descricao"]];
  for (const [field, label] of required) {
    if (!String(payload[field] || "").trim()) throw new Error(`Informe ${label}.`);
  }
  const amount = normalizeMoney(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Informe um valor maior que zero.");
  return {
    employee: user.name, employee_user_id: user.id,
    supplier: String(payload.supplier).trim(), date: String(payload.date).trim(), amount,
    project: String(payload.project).trim(), company: String(payload.company).trim(),
    description: String(payload.description || "").trim()
  };
}

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------
app.post("/api/login", async (req, res) => {
  try {
    const { username = "", password = "" } = req.body;
    const { rows } = await pool.query(
      "SELECT * FROM users WHERE lower(username) = lower($1) AND active = true",
      [username.trim()]
    );
    const user = rows[0];
    if (!user || hashPassword(password, user.password_salt) !== user.password_hash) {
      return res.status(401).json({ error: "Usuario ou senha invalidos." });
    }
    const token = crypto.randomBytes(32).toString("hex");
    await pool.query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)",
      [token, user.id, new Date(Date.now() + SESSION_TTL_MS).toISOString()]);
    res.setHeader("Set-Cookie", sessionCookie(token, SESSION_TTL_MS / 1000));
    res.json({ user: publicUser(user), token });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post("/api/logout", async (req, res) => {
  const token = parseCookies(req).session;
  if (token) await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
  res.setHeader("Set-Cookie", sessionCookie("", 0));
  res.json({ ok: true });
});

app.get("/api/session", async (req, res) => {
  const user = await getSessionUser(req);
  res.json({ user: publicUser(user) });
});

app.post("/api/change-password", requireUser, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [req.user.id]);
    const user = rows[0];
    if (!user || hashPassword(current_password, user.password_salt) !== user.password_hash) {
      return res.status(401).json({ error: "Senha atual incorreta." });
    }
    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ error: "Nova senha deve ter pelo menos 6 caracteres." });
    }
    const salt = crypto.randomBytes(12).toString("hex");
    const hash = hashPassword(new_password, salt);
    await pool.query("UPDATE users SET password_salt=$1, password_hash=$2, must_change_password=false WHERE id=$3",
      [salt, hash, req.user.id]);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
app.get("/api/bootstrap", requireUser, async (req, res) => {
  try {
    const user = req.user;
    const [companies, projects, drafts, reports] = await Promise.all([
      pool.query("SELECT name FROM companies ORDER BY name"),
      pool.query("SELECT name FROM projects ORDER BY name"),
      pool.query(`SELECT * FROM expenses WHERE status = 'draft' AND ($1 = 'admin' OR employee_user_id = $2) ORDER BY created_at`, [user.role, user.id]),
      pool.query(`SELECT r.*, COALESCE(json_agg(e.* ORDER BY e.number) FILTER (WHERE e.id IS NOT NULL), '[]') AS expenses
                    FROM reports r LEFT JOIN expenses e ON e.report_id = r.id
                   WHERE $1 = 'admin' OR r.employee_user_id = $2
                   GROUP BY r.id ORDER BY r.number DESC`, [user.role, user.id])
    ]);
    res.json({
      user: publicUser(user),
      companies: companies.rows.map(r => r.name),
      projects: projects.rows.map(r => r.name),
      draftExpenses: drafts.rows,
      reports: reports.rows
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------------------------------------------------------------------
// Users (admin only)
// ---------------------------------------------------------------------------
app.get("/api/users", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, username, name, role, active, must_change_password, created_at FROM users ORDER BY name");
    res.json({ users: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/users", requireAdmin, async (req, res) => {
  try {
    const { name, username, role = "employee" } = req.body;
    if (!name || !username) return res.status(400).json({ error: "Informe nome e usuario." });
    if (!["admin", "employee"].includes(role)) return res.status(400).json({ error: "Papel invalido." });

    const tempPassword = `${username.toLowerCase()}123`;
    const salt = crypto.randomBytes(12).toString("hex");
    const hash = hashPassword(tempPassword, salt);

    const { rows } = await pool.query(
      `INSERT INTO users (id, username, name, role, password_salt, password_hash, active, must_change_password, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, true, $7) RETURNING id, username, name, role, active, must_change_password, created_at`,
      [crypto.randomUUID(), username.trim().toLowerCase(), name.trim(), role, salt, hash, nowIso()]
    );
    res.status(201).json({ user: rows[0] });
  } catch (err) {
    if (err.code === "23505") return res.status(400).json({ error: "Nome de usuario ja existe." });
    res.status(400).json({ error: err.message });
  }
});

app.patch("/api/users/:id", requireAdmin, async (req, res) => {
  try {
    const { name, username, role, active } = req.body;
    const updates = [];
    const values = [];
    let i = 1;

    if (name !== undefined) { updates.push(`name=$${i++}`); values.push(name.trim()); }
    if (username !== undefined) { updates.push(`username=$${i++}`); values.push(username.trim().toLowerCase()); }
    if (role !== undefined) {
      if (!["admin", "employee"].includes(role)) return res.status(400).json({ error: "Papel invalido." });
      updates.push(`role=$${i++}`); values.push(role);
    }
    if (active !== undefined) { updates.push(`active=$${i++}`); values.push(active); }

    if (!updates.length) return res.status(400).json({ error: "Nenhum campo para atualizar." });
    values.push(req.params.id);

    const { rows } = await pool.query(
      `UPDATE users SET ${updates.join(", ")} WHERE id=$${i} RETURNING id, username, name, role, active, must_change_password, created_at`,
      values
    );
    if (!rows[0]) return res.status(404).json({ error: "Usuario nao encontrado." });
    res.json({ user: rows[0] });
  } catch (err) {
    if (err.code === "23505") return res.status(400).json({ error: "Nome de usuario ja existe." });
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/users/:id", requireAdmin, async (req, res) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: "Voce nao pode apagar sua propria conta." });
    await pool.query("DELETE FROM sessions WHERE user_id = $1", [req.params.id]);
    const { rowCount } = await pool.query("DELETE FROM users WHERE id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Usuario nao encontrado." });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/users/:id/reset-password", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Usuario nao encontrado." });
    const tempPassword = `${rows[0].username}123`;
    const salt = crypto.randomBytes(12).toString("hex");
    const hash = hashPassword(tempPassword, salt);
    await pool.query("UPDATE users SET password_salt=$1, password_hash=$2, must_change_password=true WHERE id=$3", [salt, hash, req.params.id]);
    res.json({ ok: true, temp_password: tempPassword });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------
app.post("/api/companies", requireUser, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Informe um nome." });
    await pool.query("INSERT INTO companies (name) VALUES ($1) ON CONFLICT (lower(name)) DO NOTHING", [name]);
    const { rows } = await pool.query("SELECT name FROM companies ORDER BY name");
    res.status(201).json({ name, companies: rows.map(r => r.name) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post("/api/projects", requireUser, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Informe um nome." });
    await pool.query("INSERT INTO projects (name) VALUES ($1) ON CONFLICT (lower(name)) DO NOTHING", [name]);
    const { rows } = await pool.query("SELECT name FROM projects ORDER BY name");
    res.status(201).json({ name, projects: rows.map(r => r.name) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------
app.post("/api/expenses", requireUser, async (req, res) => {
  try {
    const fields = validateExpense(req.body, req.user);
    const imageUrl = await uploadToR2(req.body.imageDataUrl);
    await pool.query("INSERT INTO companies (name) VALUES ($1) ON CONFLICT (lower(name)) DO NOTHING", [fields.company]);
    await pool.query("INSERT INTO projects (name) VALUES ($1) ON CONFLICT (lower(name)) DO NOTHING", [fields.project]);
    const { rows } = await pool.query(
      `INSERT INTO expenses (id, number, employee, employee_user_id, supplier, date, amount, project, company, description, image_url, status, report_id, created_at, updated_at)
       VALUES ($1, nextval('expense_number_seq'), $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft', NULL, $11, $11) RETURNING *`,
      [crypto.randomUUID(), fields.employee, fields.employee_user_id, fields.supplier, fields.date, fields.amount, fields.project, fields.company, fields.description, imageUrl, nowIso()]
    );
    const [companies, projects] = await Promise.all([
      pool.query("SELECT name FROM companies ORDER BY name"),
      pool.query("SELECT name FROM projects ORDER BY name")
    ]);
    res.status(201).json({ expense: rows[0], companies: companies.rows.map(r => r.name), projects: projects.rows.map(r => r.name) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete("/api/expenses/:id", requireUser, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM expenses WHERE id = $1", [req.params.id]);
    const expense = rows[0];
    if (!expense) return res.status(404).json({ error: "Despesa nao encontrada." });
    const canSee = req.user.role === "admin" || expense.employee_user_id === req.user.id;
    if (!canSee) return res.status(403).json({ error: "Voce nao pode remover esta despesa." });
    if (expense.status !== "draft") return res.status(409).json({ error: "Despesa ja enviada nao pode ser removida." });
    await pool.query("DELETE FROM expenses WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
app.post("/api/reports", requireUser, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const user = req.user;
    const { rows: drafts } = await client.query(
      `SELECT * FROM expenses WHERE status = 'draft' AND ($1 = 'admin' OR employee_user_id = $2)`,
      [user.role, user.id]
    );
    if (!drafts.length) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Nao ha despesas em aberto para este usuario." }); }

    const draftIds = drafts.map(e => e.report_id).filter(Boolean);
    let report = null;
    if (draftIds.length) {
      const { rows: returned } = await client.query(
        `SELECT * FROM reports WHERE status = 'returned' AND id = ANY($1) AND employee_user_id = $2 LIMIT 1`,
        [draftIds, user.id]
      );
      report = returned[0] || null;
    }

    const total = drafts.reduce((sum, e) => sum + Number(e.amount), 0);

    if (report) {
      await client.query(`UPDATE reports SET status='pending', total=$1, decision_reason='', updated_at=$2 WHERE id=$3`, [total, nowIso(), report.id]);
    } else {
      const number = (await client.query("SELECT nextval('report_number_seq') AS n")).rows[0].n;
      const id = crypto.randomUUID();
      await client.query(
        `INSERT INTO reports (id, number, code, employee, employee_user_id, status, total, decision_reason, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,'pending',$6,'',$7,$7)`,
        [id, number, formatReportCode(number), user.name, user.id, total, nowIso()]
      );
      report = (await client.query("SELECT * FROM reports WHERE id = $1", [id])).rows[0];
    }

    await client.query(
      `UPDATE expenses SET status='submitted', report_id=$1, updated_at=$2 WHERE status='draft' AND ($3 = 'admin' OR employee_user_id = $4)`,
      [report.id, nowIso(), user.role, user.id]
    );
    await client.query("COMMIT");
    const { rows: expenses } = await pool.query("SELECT * FROM expenses WHERE report_id = $1", [report.id]);
    res.status(201).json({ report: { ...report, expenses } });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

app.patch("/api/reports/:id", requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { status, reason } = req.body;
    const { rows } = await client.query("SELECT * FROM reports WHERE id = $1", [req.params.id]);
    if (!rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Pedido nao encontrado." }); }
    const allowed = ["pending", "approved", "returned"];
    if (!allowed.includes(status)) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Status invalido." }); }
    if (status === "returned" && !String(reason || "").trim()) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Informe o motivo." }); }
    const decisionReason = status === "returned" ? String(reason).trim() : "";
    await client.query("UPDATE reports SET status=$1, decision_reason=$2, updated_at=$3 WHERE id=$4", [status, decisionReason, nowIso(), req.params.id]);
    if (status === "returned") {
      await client.query("UPDATE expenses SET status='draft', updated_at=$1 WHERE report_id=$2", [nowIso(), req.params.id]);
    }
    await client.query("COMMIT");
    const { rows: updated } = await pool.query("SELECT * FROM reports WHERE id = $1", [req.params.id]);
    const { rows: expenses } = await pool.query("SELECT * FROM expenses WHERE report_id = $1", [req.params.id]);
    res.json({ report: { ...updated[0], expenses } });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// ---------------------------------------------------------------------------
// Fallback SPA
// ---------------------------------------------------------------------------
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Caixinha Reembolso rodando em http://localhost:${PORT}`);
});
