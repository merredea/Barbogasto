-- Importes en céntimos enteros. No hay columnas para fotografías.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  push_enabled INTEGER NOT NULL DEFAULT 0 CHECK (push_enabled IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions(user_id);

-- singleton = 1 impide que exista más de un grupo.
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  singleton INTEGER NOT NULL DEFAULT 1 UNIQUE CHECK (singleton = 1),
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
  created_at TEXT NOT NULL
);

CREATE TABLE group_members (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX idx_group_members_user ON group_members(user_id);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  claim_id TEXT,
  claimed_at TEXT,
  used_by TEXT REFERENCES users(id),
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_invitations_group ON invitations(group_id, created_at);

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  merchant TEXT,
  note TEXT,
  expense_date TEXT NOT NULL,
  currency TEXT NOT NULL,
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  payer_id TEXT NOT NULL REFERENCES users(id),
  split_mode TEXT NOT NULL CHECK (split_mode IN ('equal', 'items')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_expenses_group_date ON expenses(group_id, expense_date DESC, created_at DESC);

CREATE TABLE expense_participants (
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  share_cents INTEGER NOT NULL CHECK (share_cents >= 0),
  PRIMARY KEY (expense_id, user_id)
);

CREATE INDEX idx_participants_user ON expense_participants(user_id);

CREATE TABLE expense_items (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  quantity_millis INTEGER NOT NULL CHECK (quantity_millis > 0),
  unit_price_cents INTEGER,
  line_cents INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('item', 'tax', 'discount', 'tip', 'adjustment')),
  needs_review INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0, 1))
);

CREATE INDEX idx_items_expense ON expense_items(expense_id, position);

CREATE TABLE expense_item_allocations (
  item_id TEXT NOT NULL REFERENCES expense_items(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  share_cents INTEGER NOT NULL,
  PRIMARY KEY (item_id, user_id)
);

CREATE TABLE settlements (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  payer_id TEXT NOT NULL REFERENCES users(id),
  receiver_id TEXT NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  paid_on TEXT NOT NULL,
  note TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  CHECK (payer_id <> receiver_id)
);

CREATE INDEX idx_settlements_group ON settlements(group_id, paid_on DESC, created_at DESC);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_push_user ON push_subscriptions(user_id);

CREATE TABLE notification_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  period TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('push', 'in_app')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'dismissed')),
  created_at TEXT NOT NULL,
  UNIQUE (user_id, kind, period, channel)
);

CREATE TABLE idempotency_keys (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE ai_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_ai_requests_user ON ai_requests(user_id, created_at);

CREATE TABLE auth_attempts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_auth_attempts_email ON auth_attempts(email, created_at);
