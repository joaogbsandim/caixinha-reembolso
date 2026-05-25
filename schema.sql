-- =============================================================================
-- Caixinha Reembolso — Schema PostgreSQL
-- Execute no Neon SQL Editor antes de subir a aplicação
-- =============================================================================

-- Sequences para numeração sequencial legível
CREATE SEQUENCE IF NOT EXISTS expense_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS report_number_seq  START 1;

-- Usuários
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'employee')),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sessões
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx  ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

-- Catálogo de empresas
CREATE TABLE IF NOT EXISTS companies (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS companies_name_lower_idx ON companies (lower(name));

-- Catálogo de obras
CREATE TABLE IF NOT EXISTS projects (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS projects_name_lower_idx ON projects (lower(name));

-- Pedidos de reembolso
CREATE TABLE IF NOT EXISTS reports (
  id               TEXT PRIMARY KEY,
  number           INTEGER NOT NULL UNIQUE,
  code             TEXT NOT NULL,
  employee         TEXT NOT NULL,
  employee_user_id TEXT REFERENCES users(id),
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'returned')),
  total            NUMERIC(12,2) NOT NULL DEFAULT 0,
  decision_reason  TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS reports_employee_user_id_idx ON reports(employee_user_id);
CREATE INDEX IF NOT EXISTS reports_status_idx ON reports(status);

-- Despesas / comprovantes
CREATE TABLE IF NOT EXISTS expenses (
  id               TEXT PRIMARY KEY,
  number           INTEGER NOT NULL UNIQUE,
  employee         TEXT NOT NULL,
  employee_user_id TEXT REFERENCES users(id),
  supplier         TEXT NOT NULL,
  date             DATE NOT NULL,
  amount           NUMERIC(12,2) NOT NULL,
  project          TEXT NOT NULL,
  company          TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  image_url        TEXT,
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'submitted')),
  report_id        TEXT REFERENCES reports(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS expenses_status_idx           ON expenses(status);
CREATE INDEX IF NOT EXISTS expenses_report_id_idx        ON expenses(report_id);
CREATE INDEX IF NOT EXISTS expenses_employee_user_id_idx ON expenses(employee_user_id);

-- =============================================================================
-- Dados iniciais
-- =============================================================================

INSERT INTO companies (name) VALUES
  ('CBS'), ('Cobase'), ('G&A'), ('Outra empresa')
ON CONFLICT (lower(name)) DO NOTHING;

INSERT INTO projects (name) VALUES
  ('Administrativo'), ('Artesano'), ('Obra Centro'),
  ('Obra Industrial'), ('Polimix'), ('Smartfit')
ON CONFLICT (lower(name)) DO NOTHING;

-- Usuários iniciais
-- admin / admin123
-- colaborador / 123456
INSERT INTO users (id, username, name, role, password_salt, password_hash) VALUES
  (
    gen_random_uuid()::text,
    'admin', 'Administrador', 'admin',
    '6ede6aa73ac82fcb41a71e11',
    'a5be2c7d109f310cfdd0b31b54b382681285b3abb503a93a1c3f47cec9e8f915'
  ),
  (
    gen_random_uuid()::text,
    'colaborador', 'Colaborador', 'employee',
    '16b1a1c59fca04e8ee045df1',
    '00099c58a0abd84f1bc5772808459806abeb5ffb89ade8a567d9d202f04b5826'
  )
ON CONFLICT (username) DO NOTHING;
