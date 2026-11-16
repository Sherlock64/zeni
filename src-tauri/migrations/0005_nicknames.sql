CREATE TABLE nicknames (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,   -- stored trimmed
    enabled INTEGER NOT NULL DEFAULT 1,
    stale_exempt INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE nickname_rules (
    id INTEGER PRIMARY KEY,
    nickname_id INTEGER NOT NULL REFERENCES nicknames(id) ON DELETE CASCADE,
    mode TEXT NOT NULL CHECK (mode IN ('exact', 'contains', 'regex')),
    field TEXT NOT NULL CHECK (field IN ('description', 'memo')),
    pattern TEXT NOT NULL,                       -- stored trimmed, 1..=500 chars
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX nickname_rules_nickname ON nickname_rules(nickname_id);
-- Derived: the winning rule per raw transaction. Raw rows are never changed.
CREATE TABLE nickname_matches (
    raw_transaction_id INTEGER PRIMARY KEY REFERENCES raw_transactions(id) ON DELETE CASCADE,
    rule_id INTEGER NOT NULL REFERENCES nickname_rules(id) ON DELETE CASCADE
);
CREATE INDEX nickname_matches_rule ON nickname_matches(rule_id);
