"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_FILE = path.join(DATA_DIR, "db.json");
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

const INITIAL_USERS = [
  { username: "admin", password: "admin123", name: "Administrador", role: "admin" },
  { username: "colaborador", password: "123456", name: "Colaborador", role: "employee" }
];

const DEFAULT_DB = {
  companies: ["CBS", "Cobase", "G&A", "Outra empresa"],
  projects: ["Administrativo", "Artesano", "Obra Centro", "Obra Industrial", "Polimix", "Smartfit"],
  users: [],
  sessions: [],
  nextExpenseNumber: 1,
  nextReportNumber: 1,
  expenses: [],
  reports: []
};

// ---------------------------------------------------------------------------
// Storage helpers (idêntico ao original)
// ---------------------------------------------------------------------------
function ensureStorage() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(migrateDb(DEFAULT_DB), null, 2));
  }
}

function hashPassword(password, salt) {
  return crypto.createHash("sha256").update(`${salt}:${password}`).digest("hex");
}

function makeUser({ username, password, name, role }) {
  const salt = crypto.randomBytes(12).toString("hex");
  return { id: crypto.randomUUID(), username, name, role, passwordSalt: salt, passwordHash: hashPassword(password, salt), createdAt: nowIso() };
}

function uniqueNames(items) {
  const seen = new Set();
  return items.map(item => String(item || "").trim()).filter(item => {
    const key = item.toLowerCase();
    if (!item || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function migrateDb(input) {
  const db = { ...DEFAULT_DB, ...input, companies: Array.isArray(input.companies) ? input.companies : DEFAULT_DB.companies, projects: Array.isArray(input.projects) ? input.projects : DEFAULT_DB.projects, users: Array.isArray(input.users) ? input.users : [], sessions: Array.isArray(input.sessions) ? input.sessions : [], expenses: Array.isArray(input.expenses) ? input.expenses : [], reports: Array.isArray(input.reports) ? input.reports : [] };
  db.companies = uniqueNames(db.companies);
  db.projects = uniqueNames(db.projects);
  db.expenses.forEach(e => { if (e.company) db.companies.push(e.company); if (e.project) db.projects.push(e.project); });
  db.companies = uniqueNames(db.companies).sort((a, b) => a.localeCompare(b, "pt-BR"));
  db.projects = uniqueNames(db.projects).sort((a, b) => a.localeCompare(b, "pt-BR"));
  if (!db.users.length) db.users = INITIAL_USERS.map(makeUser);
  db.reports = db.reports.map(r => ({ decisionReason: "", ...r }));
  return db;
}

function readDb() {
  ensureStorage();
  return migrateDb(JSON.parse(fs.readFileSync(DB_FILE, "utf8")));
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function nowIso() { return new Date().toISOString(); }

function normalizeMoney(value) {
  if (typeof value === "number") return value;
  const text = String(value || "").trim().replace(/\./g, "").replace(",", ".");
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function formatReportCode(number) {
  return `Pedido de Reembolso ${String(number).padStart(2, "0")}`;
}

function expenseDto(expense) {
  return { ...expense, amount: Number(Number(expense.amount).toFixed(2)) };
}

function reportDto(report, expenses) {
  return { ...report, total: Number(Number(report.total).toFixed(2)), expenses: expenses.map(expenseDto) };
}

function userCanSeeExpense(user, expense) {
  return user.role === "admin" || expense.employeeUserId === user.id || (!expense.employeeUserId && expense.employee === user.name);
}

function userCanSeeReport(user, report) {
  return user.role === "admin" || report.employeeUserId === user.id || (!report.employeeUserId && report.employee === user.name);
}

function validateExpense(payload, user) {
  const required = [["supplier","fornecedor"],["date","data"],["amount","valor"],["project","obra"],["company","empresa"],["description","descricao"]];
  for (const [field, label] of required) {
    if (!String(payload[field] || "").trim()) throw new Error(`Informe ${label}.`);
  }
  const amount = normalizeMoney(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Informe um valor maior que zero.");
  return { employee: user.name, employeeUserId: user.id, supplier: String(payload.supplier).trim(), date: String(payload.date).trim(), amount, project: String(payload.project).trim(), company: String(payload.company).trim(), description: String(payload.description || "").trim() };
}

function addCatalogItem(db, key, name) {
  const value = String(name || "").trim();
  if (!value) throw new Error("Informe um nome.");
  const exists = db[key].some(item => item.toLowerCase() === value.toLowerCase());
  if (!exists) db[key].push(value);
  db[key] = uniqueNames(db[key]).sort((a, b) => a.localeCompare(b, "pt-BR"));
  return value;
}

function saveImage(dataUrl) {
  if (!dataUrl) return null;
  const match = /^data:(image\/(png|jpeg|jpg|webp|heic|heif)|application\/pdf);base64,(.+)$/i.exec(dataUrl);
  if (!match) throw new Error("Envie uma imagem PNG, JPG, WebP, HEIC ou PDF.");
  const ext = match[1].toLowerCase() === "application/pdf" ? "pdf" : match[2].toLowerCase() === "jpeg" ? "jpg" : match[2].toLowerCase();
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), Buffer.from(match[3], "base64"));
  return `/uploads/${filename}`;
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, username: user.username, name: user.name, role: user.role };
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------
function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(header.split(";").map(i => i.trim().split("=")).filter(i => i.length === 2).map(([k, v]) => [k, decodeURIComponent(v)]));
}

function sessionCookie(token, maxAge) {
  return [`session=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`].join("; ");
}

function getCurrentUser(req, db) {
  const auth = req.headers.authorization || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const token = bearer || parseCookies(req).session;
  if (!token) return null;
  const session = db.sessions.find(s => s.token === token && new Date(s.expiresAt).getTime() > Date.now());
  if (!session) return null;
  return db.users.find(u => u.id === session.userId) || null;
}

function requireUser(req, res, next) {
  const db = readDb();
  const user = getCurrentUser(req, db);
  if (!user) return res.status(401).json({ error: "Faca login para continuar." });
  req.user = user;
  req.db = db;
  next();
}

function requireAdmin(req, res, next) {
  const db = readDb();
  const user = getCurrentUser(req, db);
  if (!user) return res.status(401).json({ error: "Faca login para continuar." });
  if (user.role !== "admin") return res.status(403).json({ error: "Acesso restrito ao administrador." });
  req.user = user;
  req.db = db;
  next();
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: "35mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(UPLOAD_DIR));

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------
app.post("/api/login", (req, res) => {
  try {
    const db = readDb();
    db.sessions = db.sessions.filter(s => new Date(s.expiresAt).getTime() > Date.now());
    const { username = "", password = "" } = req.body;
    const user = db.users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());
    if (!user || hashPassword(password, user.passwordSalt) !== user.passwordHash) {
      return res.status(401).json({ error: "Usuario ou senha invalidos." });
    }
    const token = crypto.randomBytes(32).toString("hex");
    db.sessions.push({ token, userId: user.id, createdAt: nowIso(), expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() });
    writeDb(db);
    res.setHeader("Set-Cookie", sessionCookie(token, SESSION_TTL_MS / 1000));
    res.json({ user: publicUser(user), token });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/logout", (req, res) => {
  const db = readDb();
  const token = parseCookies(req).session;
  if (token) db.sessions = db.sessions.filter(s => s.token !== token);
  writeDb(db);
  res.setHeader("Set-Cookie", sessionCookie("", 0));
  res.json({ ok: true });
});

app.get("/api/session", (req, res) => {
  const db = readDb();
  const user = getCurrentUser(req, db);
  res.json({ user: publicUser(user) });
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
app.get("/api/bootstrap", requireUser, (req, res) => {
  const db = req.db;
  const user = req.user;
  const reports = db.reports
    .filter(r => userCanSeeReport(user, r))
    .map(r => reportDto(r, db.expenses.filter(e => e.reportId === r.id)))
    .sort((a, b) => b.number - a.number);

  res.json({
    user: publicUser(user),
    companies: db.companies,
    projects: db.projects,
    nextReportCode: formatReportCode(db.nextReportNumber),
    draftExpenses: db.expenses.filter(e => e.status === "draft" && userCanSeeExpense(user, e)).map(expenseDto),
    reports
  });
});

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------
app.post("/api/companies", requireUser, (req, res) => {
  try {
    const db = req.db;
    const name = addCatalogItem(db, "companies", req.body.name);
    writeDb(db);
    res.status(201).json({ name, companies: db.companies });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/projects", requireUser, (req, res) => {
  try {
    const db = req.db;
    const name = addCatalogItem(db, "projects", req.body.name);
    writeDb(db);
    res.status(201).json({ name, projects: db.projects });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------
app.post("/api/expenses", requireUser, (req, res) => {
  try {
    const db = req.db;
    const fields = validateExpense(req.body, req.user);
    const imageUrl = saveImage(req.body.imageDataUrl);
    addCatalogItem(db, "companies", fields.company);
    addCatalogItem(db, "projects", fields.project);
    const expense = { id: crypto.randomUUID(), number: db.nextExpenseNumber++, ...fields, imageUrl, status: "draft", reportId: null, createdAt: nowIso(), updatedAt: nowIso() };
    db.expenses.push(expense);
    writeDb(db);
    res.status(201).json({ expense: expenseDto(expense), companies: db.companies, projects: db.projects });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/expenses/:id", requireUser, (req, res) => {
  const db = req.db;
  const expense = db.expenses.find(e => e.id === req.params.id);
  if (!expense) return res.status(404).json({ error: "Despesa nao encontrada." });
  if (!userCanSeeExpense(req.user, expense)) return res.status(403).json({ error: "Voce nao pode remover esta despesa." });
  if (expense.status !== "draft") return res.status(409).json({ error: "Despesa ja enviada nao pode ser removida." });
  db.expenses = db.expenses.filter(e => e.id !== expense.id);
  writeDb(db);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
app.post("/api/reports", requireUser, (req, res) => {
  const db = req.db;
  const user = req.user;
  const draftExpenses = db.expenses.filter(e => e.status === "draft" && userCanSeeExpense(user, e));
  if (!draftExpenses.length) return res.status(400).json({ error: "Nao ha despesas em aberto para este usuario." });

  const returnedReport = db.reports.find(r =>
    r.status === "returned" && userCanSeeReport(user, r) && draftExpenses.some(e => e.reportId === r.id)
  );

  const report = returnedReport || {
    id: crypto.randomUUID(), number: db.nextReportNumber++,
    code: formatReportCode(db.nextReportNumber - 1),
    employee: user.name, employeeUserId: user.id,
    status: "pending", total: 0, decisionReason: "",
    createdAt: nowIso(), updatedAt: nowIso()
  };

  report.employee = user.name;
  report.employeeUserId = user.id;
  report.status = "pending";
  report.total = draftExpenses.reduce((sum, e) => sum + e.amount, 0);
  report.decisionReason = "";
  report.updatedAt = nowIso();

  draftExpenses.forEach(e => { e.status = "submitted"; e.reportId = report.id; e.updatedAt = nowIso(); });
  if (!returnedReport) db.reports.push(report);
  writeDb(db);
  res.status(201).json({ report: reportDto(report, draftExpenses) });
});

app.patch("/api/reports/:id", requireAdmin, (req, res) => {
  try {
    const db = req.db;
    const report = db.reports.find(r => r.id === req.params.id);
    if (!report) return res.status(404).json({ error: "Pedido nao encontrado." });

    const { status, reason } = req.body;
    const allowed = ["pending", "approved", "returned"];
    if (!allowed.includes(status)) return res.status(400).json({ error: "Status invalido." });
    if (status === "returned" && !String(reason || "").trim()) return res.status(400).json({ error: "Informe o motivo." });

    report.status = status;
    report.decisionReason = status === "returned" ? String(reason).trim() : "";
    report.updatedAt = nowIso();

    if (status === "returned") {
      db.expenses.filter(e => e.reportId === report.id).forEach(e => { e.status = "draft"; e.updatedAt = nowIso(); });
    }

    writeDb(db);
    res.json({ report: reportDto(report, db.expenses.filter(e => e.reportId === report.id)) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
ensureStorage();
writeDb(readDb());

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Caixinha Reembolso (local) rodando em http://localhost:${PORT}`);
});
