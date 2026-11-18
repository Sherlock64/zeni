CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,          -- trimmed, 1..=40 chars
    description TEXT NOT NULL DEFAULT '',              -- trimmed, 0..=200 chars
    kind TEXT NOT NULL CHECK (kind IN ('spending', 'income', 'transfer')),
    sort_order INTEGER NOT NULL
);
INSERT INTO categories (name, description, kind, sort_order) VALUES
    ('Housing', 'Rent or mortgage, HOA fees, renter''s or home insurance', 'spending', 1),
    ('Utilities', 'Electricity, gas, water, sewer and trash', 'spending', 2),
    ('Phone and internet', 'Mobile phone, home internet and cable', 'spending', 3),
    ('Groceries', 'Supermarkets and grocery stores; food to cook at home', 'spending', 4),
    ('Dining out', 'Restaurants, cafes, coffee shops, takeout and delivery', 'spending', 5),
    ('Gas and fuel', 'Gas stations and EV charging', 'spending', 6),
    ('Transportation', 'Car payments, auto insurance, repairs, parking, tolls, transit, rideshare', 'spending', 7),
    ('Shopping', 'General merchandise, online orders, clothing, electronics, household goods', 'spending', 8),
    ('Subscriptions', 'Streaming, music, software and other recurring memberships', 'spending', 9),
    ('Entertainment', 'Movies, events, games and hobbies', 'spending', 10),
    ('Health and fitness', 'Doctor, dentist, pharmacy and gym memberships', 'spending', 11),
    ('Personal care', 'Haircuts, cosmetics and toiletries', 'spending', 12),
    ('Insurance', 'Health, life and other premiums not tied to home or car', 'spending', 13),
    ('Travel', 'Flights, hotels and vacation rentals', 'spending', 14),
    ('Gifts and donations', 'Presents and charitable giving', 'spending', 15),
    ('Fees and interest', 'Bank fees, ATM fees, late fees and interest charges', 'spending', 16),
    ('Cash and checks', 'ATM withdrawals and checks whose purpose is unknown', 'spending', 17),
    ('Other spending', 'Spending that fits no other category', 'spending', 18),
    ('Paycheck', 'Salary and wages from an employer', 'income', 19),
    ('Other income', 'Interest, dividends, tax refunds and money received', 'income', 20),
    ('Savings transfer', 'Money moved to or from your own savings account', 'transfer', 21),
    ('Credit card payment', 'Payments to your own credit card account', 'transfer', 22);
ALTER TABLE nicknames ADD COLUMN default_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL;
CREATE TABLE model_builds (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,                         -- zeni-<id>
    base_model TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    example_count INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 0,
    out_of_date INTEGER NOT NULL DEFAULT 0,
    sent TEXT NOT NULL                                 -- JSON body sent to /api/create
);
CREATE UNIQUE INDEX model_builds_one_active ON model_builds(active) WHERE active = 1;
CREATE TABLE transaction_categories (
    raw_transaction_id INTEGER PRIMARY KEY REFERENCES raw_transactions(id) ON DELETE CASCADE,
    user_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    model_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    model_build_id INTEGER REFERENCES model_builds(id) ON DELETE SET NULL,
    model_reviewed INTEGER NOT NULL DEFAULT 0,
    note TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 500),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX transaction_categories_user ON transaction_categories(user_category_id);
CREATE INDEX transaction_categories_model ON transaction_categories(model_category_id);
-- Any category change marks every build out of date.
CREATE TRIGGER categories_out_of_date_insert AFTER INSERT ON categories BEGIN UPDATE model_builds SET out_of_date = 1; END;
CREATE TRIGGER categories_out_of_date_update AFTER UPDATE ON categories BEGIN UPDATE model_builds SET out_of_date = 1; END;
CREATE TRIGGER categories_out_of_date_delete AFTER DELETE ON categories BEGIN UPDATE model_builds SET out_of_date = 1; END;
-- The effective category: the user's, else the enabled nickname's default, else the model's.
CREATE VIEW effective_categories AS
SELECT r.id AS raw_transaction_id,
       n.name AS nickname,
       COALESCE(t.user_category_id, n.default_category_id, t.model_category_id) AS category_id,
       CASE WHEN t.user_category_id IS NOT NULL THEN 'user'
            WHEN n.default_category_id IS NOT NULL THEN 'nickname'
            WHEN t.model_category_id IS NOT NULL THEN 'model' END AS set_by,
       CASE WHEN t.user_category_id IS NOT NULL OR n.default_category_id IS NOT NULL THEN 1
            WHEN t.model_category_id IS NOT NULL THEN t.model_reviewed ELSE 0 END AS reviewed,
       CASE WHEN t.user_category_id IS NULL AND n.default_category_id IS NULL THEN t.model_build_id END AS model_build_id,
       t.note
FROM raw_transactions r
LEFT JOIN transaction_categories t ON t.raw_transaction_id = r.id
LEFT JOIN nickname_matches m ON m.raw_transaction_id = r.id
LEFT JOIN nickname_rules nr ON nr.id = m.rule_id
LEFT JOIN nicknames n ON n.id = nr.nickname_id AND n.enabled = 1;
