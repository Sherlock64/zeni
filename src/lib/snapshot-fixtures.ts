const recoveryCodes = [
  "7K3QD-M9X2A-PZ4TB-HN6WE",
  "Q2V8R-J5C1F-TY7GM-0KD3S",
  "B4NZ6-W8E2H-R1XAP-QM5TJ",
  "H9T3K-C6Y0V-NB2GD-ZP8RW",
  "M1S7E-X4QJA-F3V9K-TD6NB",
  "Y5G2P-R8H0W-KC4MZ-EJ1TQ",
  "D3W9N-T6B1X-QA7HS-VG2KM",
  "Z8C4J-E1M5R-PY3TW-HN0FB",
];

const bankHeaders = ["Transaction ID", "Posting Date", "Effective Date", "Transaction Type", "Amount", "Check Number", "Reference Number", "Description", "Transaction Category", "Type", "Balance", "Memo", "Extended Description", "Posting Status"];
const bankMapping = {
  dateFormat: "MM/DD/YYYY",
  postedDate: 1,
  description: 7,
  amount: { kind: "signed", column: 4 },
  transactionId: 0,
  memo: 12,
  transactionType: 3,
  runningBalance: 10,
  postingStatus: 13,
  bankCategory: 8,
};

export const csvSummary = {
  importId: 4,
  fileName: "checking-2026-10.csv",
  format: "csv",
  added: 25,
  duplicates: 0,
  balanceCheck: "passed",
  ledgerBalanceCents: 1029791,
  expectedBalanceCents: 1029791,
  notPosted: 1,
  reviewSkipped: 2,
  fileBalanceCheck: "passed",
  categorizeNotice: null,
};

// import_file answers for `?import=mapping|review|csv|mismatch`.
export const importSteps: Record<string, unknown> = {
  mapping: {
    step: "needsMapping",
    data: {
      fileName: "checking-2026-10.csv",
      headers: bankHeaders,
      rows: [],
    },
  },
  review: {
    step: "review",
    data: {
      fileName: "checking-2026-10.csv",
      format: "csv",
      pairs: [
        {
          rowIndex: 4,
          newRow: { postedDate: "2026-10-05", amountCents: -4500, description: "CITY WATER UTILITY AUTOPAY" },
          existing: { postedDate: "2026-10-03", amountCents: -4500, description: "CITY WATER UTILITY" },
          existingFileName: "checking-2026-10.ofx",
          existingFormat: "ofx",
        },
        {
          rowIndex: 11,
          newRow: { postedDate: "2026-10-20", amountCents: -3275, description: "SHELL FUEL 0193 SPRINGFIELD" },
          existing: { postedDate: "2026-10-21", amountCents: -3275, description: "SHELL FUEL 0193" },
          existingFileName: "checking-2026-10.ofx",
          existingFormat: "ofx",
        },
      ],
    },
  },
  csv: { step: "imported", data: csvSummary },
  mismatch: { step: "imported", data: { ...csvSummary, notPosted: 0, reviewSkipped: 0, fileBalanceCheck: "mismatch" } },
};

const backupFolder = "/home/user/.local/share/com.sherlock64.zeni/backups";

// Fake command responses for snapshot.html, keyed by command name. Fake data only.
export const fixtures: Record<string, unknown> = {
  app_info: {
    name: "Zeni",
    version: "7.0.0",
    dbPath: "/home/user/.local/share/com.sherlock64.zeni/zeni.db",
    migrationsApplied: 3,
  },
  complete_setup: { recoveryCodes, keyringSaved: true },
  unlock: null,
  recover: null,
  reset_security: null,
  regenerate_recovery_codes: { codes: [...recoveryCodes].reverse() },
  list_accounts: [
    { id: 1, name: "Checking", owner: "Sam Rivera", bankName: "Example Community Bank" },
    { id: 2, name: "Joint savings", owner: "Sam and Alex Rivera", bankName: "Sample Credit Union" },
  ],
  reveal_account_numbers: { accountNumber: "000123456789", routingNumber: "011000015" },
  import_file: {
    step: "imported",
    data: {
      importId: 3,
      fileName: "checking-2026-10.qfx",
      format: "qfx",
      added: 12,
      duplicates: 3,
      balanceCheck: "passed",
      ledgerBalanceCents: 482317,
      expectedBalanceCents: 482317,
      notPosted: 0,
      reviewSkipped: 0,
      fileBalanceCheck: "notChecked",
      categorizeNotice: null,
    },
  },
  list_imports: [
    {
      id: 3,
      fileName: "checking-2026-10.qfx",
      format: "qfx",
      importedAt: "2026-11-02 18:04:11",
      accountId: 1,
      rowCount: 12,
      ledgerBalanceCents: 482317,
      balanceAsOf: "2026-10-31",
      expectedBalanceCents: 482317,
      balanceCheck: "passed",
      fileBalanceCheck: "notChecked",
    },
    {
      id: 2,
      fileName: "checking-2026-09.ofx",
      format: "ofx",
      importedAt: "2026-10-03 08:41:57",
      accountId: 1,
      rowCount: 23,
      ledgerBalanceCents: 397150,
      balanceAsOf: "2026-09-30",
      expectedBalanceCents: 402150,
      balanceCheck: "mismatch",
      fileBalanceCheck: "notChecked",
    },
    {
      id: 1,
      fileName: "checking-2026-08.qfx",
      format: "qfx",
      importedAt: "2026-09-01 20:15:32",
      accountId: 1,
      rowCount: 22,
      ledgerBalanceCents: 351004,
      balanceAsOf: "2026-08-31",
      expectedBalanceCents: null,
      balanceCheck: "baseline",
      fileBalanceCheck: "notChecked",
    },
  ],
  revert_import: null,
  preview_csv_mapping: [
    { line: 2, postedDate: "2026-10-31", amountCents: -1850, description: "CORNER COFFEE ROASTERS", transactionId: "T-20261031-01", memo: "Card purchase 1234", transactionType: "Debit", runningBalanceCents: 1027941, postingStatus: "Posted", bankCategory: "Dining", error: null },
    { line: 3, postedDate: "2026-10-30", amountCents: 210000, description: "ACME CORP PAYROLL", transactionId: "T-20261030-01", memo: "Direct deposit", transactionType: "Credit", runningBalanceCents: 1029791, postingStatus: "Posted", bankCategory: "Income", error: null },
    { line: 4, postedDate: null, amountCents: null, description: null, transactionId: null, memo: null, transactionType: null, runningBalanceCents: null, postingStatus: null, bankCategory: null, error: "Posting Date: 13/45/2026 isn't a MM/DD/YYYY date." },
    { line: 5, postedDate: "2026-10-28", amountCents: -12000, description: "CITY WATER UTILITY", transactionId: "T-20261028-01", memo: "Autopay ref 88213", transactionType: "Debit", runningBalanceCents: 819791, postingStatus: "Posted", bankCategory: "Utilities", error: null },
    { line: 6, postedDate: "2026-10-27", amountCents: -4599, description: "STREAMFLIX SUBSCRIPTION", transactionId: null, memo: null, transactionType: "Debit", runningBalanceCents: 831791, postingStatus: "Pending", bankCategory: "Entertainment", error: null },
  ],
  save_csv_layout: { step: "imported", data: csvSummary },
  commit_import: csvSummary,
  cancel_import: null,
  delete_csv_layout: null,
  list_csv_layouts: [
    { id: 1, name: "Example Community Bank", headers: bankHeaders.map((h) => h.toLowerCase()), mapping: bankMapping },
    {
      id: 2,
      name: "Sample card (debit and credit)",
      headers: ["date", "description", "debit", "credit", "balance"],
      mapping: {
        dateFormat: "YYYY-MM-DD",
        postedDate: 0,
        description: 1,
        amount: { kind: "split", debit: 2, credit: 3 },
        transactionId: null,
        memo: null,
        transactionType: null,
        runningBalance: 4,
        postingStatus: null,
        bankCategory: null,
      },
    },
  ],
  list_transactions: {
    rows: [
      { id: 101, importId: 1, postedDate: "2026-10-31", amountCents: -1850, description: "CORNER COFFEE ROASTERS", memo: "Card purchase 1234", transactionType: "POS", runningBalanceCents: null, nickname: "Corner Coffee", categoryId: 5, category: "Dining out", setBy: "model", reviewed: false, note: null },
      { id: 100, importId: 1, postedDate: "2026-10-30", amountCents: 245000, description: "ACME CORP PAYROLL", memo: "Direct deposit", transactionType: "DIRECTDEP", runningBalanceCents: null, nickname: "Paycheck", categoryId: 19, category: "Paycheck", setBy: "nickname", reviewed: true, note: null },
      { id: 99, importId: 1, postedDate: "2026-10-29", amountCents: -8642, description: "GREENLEAF MARKET #42", memo: null, transactionType: null, runningBalanceCents: null, nickname: null, categoryId: 4, category: "Groceries", setBy: "model", reviewed: false, note: null },
      { id: 98, importId: 1, postedDate: "2026-10-28", amountCents: -12000, description: "CITY WATER UTILITY", memo: "Autopay ref 88213", transactionType: null, runningBalanceCents: null, nickname: "Water bill", categoryId: 2, category: "Utilities", setBy: "nickname", reviewed: true, note: null },
      { id: 97, importId: 1, postedDate: "2026-10-27", amountCents: -4599, description: "STREAMFLIX SUBSCRIPTION", memo: null, transactionType: null, runningBalanceCents: null, nickname: "Streamflix", categoryId: 9, category: "Subscriptions", setBy: "nickname", reviewed: true, note: null },
      { id: 96, importId: 1, postedDate: "2026-10-26", amountCents: -6000, description: "ATM WITHDRAWAL 5TH AVE", memo: "Fee waived", transactionType: null, runningBalanceCents: null, nickname: null, categoryId: 17, category: "Cash and checks", setBy: "user", reviewed: true, note: "Cash for the farmers market" },
      { id: 95, importId: 1, postedDate: "2026-10-24", amountCents: 1525, description: "REFUND PAPER & INK CO", memo: null, transactionType: null, runningBalanceCents: null, nickname: null, categoryId: 8, category: "Shopping", setBy: "model", reviewed: true, note: null },
      { id: 94, importId: 1, postedDate: "2026-10-22", amountCents: -185000, description: "MAPLE STREET APARTMENTS", memo: "Rent October", transactionType: null, runningBalanceCents: null, nickname: "Rent", categoryId: 1, category: "Housing", setBy: "nickname", reviewed: true, note: null },
      { id: 93, importId: 1, postedDate: "2026-10-20", amountCents: -3275, description: "SHELL FUEL 0193", memo: null, transactionType: null, runningBalanceCents: null, nickname: null, categoryId: 6, category: "Gas and fuel", setBy: "model", reviewed: false, note: null },
      { id: 92, importId: 1, postedDate: "2026-10-18", amountCents: -2210, description: "PIZZERIA NAPOLI", memo: null, transactionType: null, runningBalanceCents: null, nickname: null, categoryId: 5, category: "Dining out", setBy: "model", reviewed: false, note: null },
      { id: 91, importId: 1, postedDate: "2026-10-16", amountCents: -15000, description: "TRANSFER TO SAVINGS", memo: "Online transfer", transactionType: null, runningBalanceCents: null, nickname: null, categoryId: 21, category: "Savings transfer", setBy: "user", reviewed: true, note: null },
      { id: 90, importId: 1, postedDate: "2026-10-15", amountCents: 312, description: "INTEREST PAYMENT", memo: null, transactionType: null, runningBalanceCents: null, nickname: null, categoryId: null, category: null, setBy: null, reviewed: false, note: null },
    ],
    total: 57,
  },
};

const backups = [
  { fileName: "zeni-20261115-090012-daily.db", kind: "daily", createdAt: "2026-11-15 09:00:12", sizeBytes: 1843200 },
  { fileName: "zeni-20261114-183045-manual.db", kind: "manual", createdAt: "2026-11-14 18:30:45", sizeBytes: 1839104 },
  { fileName: "zeni-20261113-080005-pre-update.db", kind: "preUpdate", createdAt: "2026-11-13 08:00:05", sizeBytes: 1810432 },
  { fileName: "zeni-20261112-150301-pre-revert.db", kind: "preRevert", createdAt: "2026-11-12 15:03:01", sizeBytes: 1802240 },
  { fileName: "zeni-20261102-101500-safety.db", kind: "safety", createdAt: "2026-11-02 10:15:00", sizeBytes: 1622016 },
].map((file) => ({ ...file, path: `${backupFolder}/${file.fileName}` }));

// `?dailyWarning=1` shows the failed daily backup warning. Read here because snapshot.ts only passes params to securityStatus.
const backupSettings = {
  folder: backupFolder,
  isDefaultFolder: true,
  keepAutomatic: 14,
  dailyWarning:
    new URLSearchParams(globalThis.location?.search).get("dailyWarning") === "1"
      ? "The backup folder /media/usb/zeni-backups doesn't exist."
      : null,
};

Object.assign(fixtures, {
  backup_settings: backupSettings,
  choose_backup_folder: { ...backupSettings, folder: "/media/usb/zeni-backups", isDefaultFolder: false },
  set_backup_retention: backupSettings,
  back_up_now: { ...backups[1], fileName: "zeni-20261115-140322-manual.db", createdAt: "2026-11-15 14:03:22", path: `${backupFolder}/zeni-20261115-140322-manual.db` },
  list_backups: backups,
  pick_restore_file: { fileName: "zeni-copy.db", path: "/home/user/Documents/zeni-copy.db", kind: "other", createdAt: "2026-10-30 21:12:05", sizeBytes: 1720320 },
  restore_backup: null,
  undo_restore: null,
});

// Startup ready, up to date and nothing pending by default, so other snapshots don't change.
const upToDate = { checksEnabled: true, checking: false, last: { date: "2026-11-15", result: { state: "upToDate" } }, banner: null };
const newer = { version: "7.1.0", url: "https://github.com/Sherlock64/zeni/releases/tag/v7.1.0" };
const notes = [
  { version: "7.1.0", lines: ["Zeni now shows spending by month.", "- Monthly totals on the Transactions page.", "- Export a month as CSV."] },
  { version: "7.0.0", lines: ["- Zeni now tells you when an update is out.", "- A backup is taken before an update changes your data.", "- See what changed in Settings > About."] },
];
Object.assign(fixtures, {
  startup_status: { state: "ready" },
  continue_startup: { state: "ready" },
  update_status: upToDate,
  check_for_updates: upToDate,
  dismiss_update: upToDate,
  set_update_checks: { ...upToDate, checksEnabled: false },
  release_notes: { pending: [], all: notes },
  acknowledge_release_notes: null,
});

// Nicknames ordered by name: one stale, one disabled, one stale-exempt, one never matched.
const nicknames = [
  { name: "Corner Coffee", matchCount: 9, lastMatched: "2026-10-31", rules: [{ mode: "exact", field: "description", pattern: "CORNER COFFEE ROASTERS", matchCount: 9, lastMatched: "2026-10-31" }] },
  { name: "Gym membership", matchCount: 4, lastMatched: "2026-05-02", stale: true, rules: [{ mode: "contains", field: "description", pattern: "ironworks gym", matchCount: 4, lastMatched: "2026-05-02" }] },
  { name: "Holiday shopping", enabled: false, matchCount: 0, lastMatched: null, stale: true, rules: [{ mode: "contains", field: "description", pattern: "gift barn", matchCount: 0, lastMatched: null }] },
  { name: "Home insurance", staleExempt: true, matchCount: 1, lastMatched: "2026-03-15", rules: [{ mode: "exact", field: "description", pattern: "SAFEHARBOR INSURANCE ANNUAL", matchCount: 1, lastMatched: "2026-03-15" }] },
  { name: "Parking", matchCount: 0, lastMatched: null, stale: true, rules: [{ mode: "regex", field: "description", pattern: "^park(ing)? \\d+", matchCount: 0, lastMatched: null }] },
  {
    name: "Paycheck",
    defaultCategoryId: 19,
    matchCount: 3,
    lastMatched: "2026-10-30",
    rules: [
      { mode: "exact", field: "description", pattern: "ACME CORP PAYROLL", matchCount: 2, lastMatched: "2026-10-30" },
      { mode: "contains", field: "memo", pattern: "direct deposit", matchCount: 1, lastMatched: "2026-09-30" },
    ],
  },
  { name: "Rent", defaultCategoryId: 1, matchCount: 3, lastMatched: "2026-10-22", rules: [{ mode: "exact", field: "description", pattern: "MAPLE STREET APARTMENTS", matchCount: 3, lastMatched: "2026-10-22" }] },
  { name: "Streamflix", defaultCategoryId: 9, matchCount: 3, lastMatched: "2026-10-27", rules: [{ mode: "contains", field: "description", pattern: "streamflix", matchCount: 3, lastMatched: "2026-10-27" }] },
  { name: "Water bill", defaultCategoryId: 2, matchCount: 3, lastMatched: "2026-10-28", rules: [{ mode: "exact", field: "description", pattern: "CITY WATER UTILITY", matchCount: 3, lastMatched: "2026-10-28" }] },
].map((nickname, index) => {
  const id = index + 1;
  const rules = nickname.rules.map((rule, ruleIndex) => ({ ...rule, id: id * 10 + ruleIndex, nicknameId: id }));
  return { enabled: true, staleExempt: false, stale: false, defaultCategoryId: null, ...nickname, id, rules };
});

Object.assign(fixtures, {
  list_nicknames: nicknames,
  save_nickname_rule: nicknames[0],
  count_rule_matches: 12,
  update_nickname: nicknames[0],
  delete_nickname: null,
  update_nickname_rule: nicknames[0],
  delete_nickname_rule: null,
  nickname_settings: { staleDays: 90 },
  set_nickname_stale_days: { staleDays: 90 },
});

// The 22 starter categories, with fake row counts; the nicknames above default to Housing, Utilities, Subscriptions and Paycheck.
const starterCategories: [string, string, string, number][] = [
  ["Housing", "spending", "Rent or mortgage, HOA fees, renter's or home insurance", 3],
  ["Utilities", "spending", "Electricity, gas, water, sewer and trash", 3],
  ["Phone and internet", "spending", "Mobile phone, home internet and cable", 2],
  ["Groceries", "spending", "Supermarkets and grocery stores; food to cook at home", 8],
  ["Dining out", "spending", "Restaurants, cafes, coffee shops, takeout and delivery", 11],
  ["Gas and fuel", "spending", "Gas stations and EV charging", 4],
  ["Transportation", "spending", "Car payments, auto insurance, repairs, parking, tolls, transit, rideshare", 1],
  ["Shopping", "spending", "General merchandise, online orders, clothing, electronics, household goods", 5],
  ["Subscriptions", "spending", "Streaming, music, software and other recurring memberships", 3],
  ["Entertainment", "spending", "Movies, events, games and hobbies", 0],
  ["Health and fitness", "spending", "Doctor, dentist, pharmacy and gym memberships", 2],
  ["Personal care", "spending", "Haircuts, cosmetics and toiletries", 0],
  ["Insurance", "spending", "Health, life and other premiums not tied to home or car", 1],
  ["Travel", "spending", "Flights, hotels and vacation rentals", 0],
  ["Gifts and donations", "spending", "Presents and charitable giving", 1],
  ["Fees and interest", "spending", "Bank fees, ATM fees, late fees and interest charges", 1],
  ["Cash and checks", "spending", "ATM withdrawals and checks whose purpose is unknown", 2],
  ["Other spending", "spending", "Spending that fits no other category", 0],
  ["Paycheck", "income", "Salary and wages from an employer", 3],
  ["Other income", "income", "Interest, dividends, tax refunds and money received", 1],
  ["Savings transfer", "transfer", "Money moved to or from your own savings account", 2],
  ["Credit card payment", "transfer", "Payments to your own credit card account", 0],
];
const categories = starterCategories.map(([name, kind, description, rowCount], index) => ({
  id: index + 1,
  name,
  description,
  kind,
  sortOrder: index + 1,
  rowCount,
  nicknameCount: nicknames.filter((nickname) => nickname.defaultCategoryId === index + 1).length,
}));

const transactionRows = (fixtures.list_transactions as { rows: { id: number }[] }).rows;
const row = (id: number) => transactionRows.find((r) => r.id === id);
// The model's unreviewed answers, grouped in category sort order, newest first.
const reviewGroups = [
  {
    categoryId: 4,
    category: "Groceries",
    rows: [
      row(99),
      { id: 60, importId: 1, postedDate: "2026-10-12", amountCents: -5630, description: "FRESH MART #12", memo: null, transactionType: null, runningBalanceCents: null, nickname: null, categoryId: 4, category: "Groceries", setBy: "model", reviewed: false, note: null },
      // Enough older rows that the group shows "Show 25 more".
      ...Array.from({ length: 30 }, (_, i) => ({
        id: 300 - i,
        importId: 1,
        postedDate: `2026-09-${String(30 - i).padStart(2, "0")}`,
        amountCents: -(1200 + i * 137),
        description: ["FRESH MART #12", "GREENLEAF MARKET #42", "CORNER BAKERY"][i % 3],
        memo: null,
        transactionType: null,
        runningBalanceCents: null,
        nickname: null,
        categoryId: 4,
        category: "Groceries",
        setBy: "model",
        reviewed: false,
        note: null,
      })),
    ],
  },
  { categoryId: 5, category: "Dining out", rows: [row(101), row(92)] },
  { categoryId: 6, category: "Gas and fuel", rows: [row(93)] },
];

const recommended = [
  { name: "phi4-mini", sizeBytes: 2491876774, note: "Best pick: 51 of 52 sample rows right, about 0.4 s a row.", installed: true },
  { name: "qwen2.5:3b", sizeBytes: 1929912432, note: "Smallest download: 46 of 52 right, about 0.4 s a row.", installed: false },
  { name: "gemma3:4b", sizeBytes: 3350272403, note: "Slower alternative: 44 of 52 right, about 1.8 s a row.", installed: false },
];
const ollamaSettings = { port: 11434, baseModel: "phi4-mini", autoCategorize: true, examplesPerCategory: 5, allowOverWindow: false };
const idleJob = { running: null, last: null };
const categorizing = { running: { kind: "categorizeNow", label: "Categorize now", done: 18, total: 42 }, last: null };

Object.assign(fixtures, {
  list_categories: categories,
  add_category: { ...categories[21], id: 23, name: "Pets", description: "Food, vet and grooming", kind: "spending", sortOrder: 23, rowCount: 0, nicknameCount: 0 },
  update_category: categories[3],
  reorder_categories: categories,
  delete_category: null,
  set_transaction_category: null,
  set_transactions_category: 11,
  ollama_settings: ollamaSettings,
  set_ollama_port: ollamaSettings,
  set_base_model: ollamaSettings,
  set_auto_categorize: ollamaSettings,
  set_examples_per_category: ollamaSettings,
  set_allow_over_window: ollamaSettings,
  ollama_status: {
    reachable: true,
    version: "0.12.6",
    installed: [
      { name: "phi4-mini:latest", sizeBytes: 2491876774 },
      { name: "zeni-2:latest", sizeBytes: 2491877102 },
    ],
    recommended,
  },
  start_model_download: { running: { kind: "download", label: "Download qwen2.5:3b", done: 0, total: 1929912432 }, last: null },
  job_status: idleJob,
  cancel_job: null,
  clear_job_outcome: null,
  start_categorize: categorizing,
  review_groups: reviewGroups,
  unreviewed_count: reviewGroups.reduce((sum, group) => sum + group.rows.length, 0),
  mark_reviewed: null,
  list_builds: [
    { id: 2, name: "zeni-2", baseModel: "phi4-mini", createdAt: "2026-11-10 19:22:04", exampleCount: 41, active: true, outOfDate: true },
    { id: 1, name: "zeni-1", baseModel: "phi4-mini", createdAt: "2026-11-03 08:15:47", exampleCount: 27, active: false, outOfDate: true },
  ],
  build_preview: { windowTokens: 4096, fit: 110, total: 110 },
  start_build: { running: { kind: "build", label: "Build zeni-3", done: 0, total: 0 }, last: null },
  activate_build: null,
  delete_build: null,
  spending_summary: {
    categories: [
      { categoryId: 1, name: "Housing", kind: "spending", count: 1, spendingCents: 185000, incomeCents: 0 },
      { categoryId: 4, name: "Groceries", kind: "spending", count: 2, spendingCents: 14272, incomeCents: 0 },
      { categoryId: 19, name: "Paycheck", kind: "income", count: 1, spendingCents: 0, incomeCents: 245000 },
      { categoryId: 21, name: "Savings transfer", kind: "transfer", count: 1, spendingCents: 0, incomeCents: 0 },
    ],
    uncategorizedCount: 1,
    uncategorizedCents: 312,
  },
});

// Alternative answers, picked with `?<param>=<value>` (snapshot.ts applies them over the fixtures above).
export const variants: Record<string, Record<string, Record<string, unknown>>> = {
  categories: { empty: { list_categories: [] } },
  review: { empty: { review_groups: [], unreviewed_count: 0 } },
  builds: { empty: { list_builds: [] } },
  preview: {
    trimmed: { build_preview: { windowTokens: 4096, fit: 29, total: 110 } },
    override: {
      build_preview: { windowTokens: 4096, fit: 29, total: 110 },
      ollama_settings: { ...ollamaSettings, allowOverWindow: true },
      set_allow_over_window: { ...ollamaSettings, allowOverWindow: true },
    },
  },
  job: {
    categorizing: { job_status: categorizing },
    recategorizing: { job_status: { running: { kind: "recategorizeAll", label: "Recategorize all", done: 120, total: 310 }, last: null } },
    afterImport: { job_status: { running: { kind: "afterImport", label: "Categorizing new rows", done: 4, total: 25 }, last: null } },
    download: { job_status: fixtures.start_model_download },
    downloadHalf: { job_status: { running: { kind: "download", label: "Download qwen2.5:3b", done: 812000000, total: 1929912432 }, last: null } },
    build: { job_status: fixtures.start_build },
    summary: {
      job_status: { running: null, last: { kind: "categorizeNow", label: "Categorize now", cancelled: false, error: null, summary: { categorized: 38, couldntCategorize: 3, notReached: 0 } } },
    },
    cancelled: {
      job_status: { running: null, last: { kind: "recategorizeAll", label: "Recategorize all", cancelled: true, error: null, summary: { categorized: 120, couldntCategorize: 2, notReached: 188 } } },
    },
    failed: {
      job_status: {
        running: null,
        last: { kind: "categorizeNow", label: "Categorize now", cancelled: false, error: "Ollama isn't running on port 11434. Start it with `ollama serve`.", summary: { categorized: 12, couldntCategorize: 0, notReached: 30 } },
      },
    },
    downloaded: { job_status: { running: null, last: { kind: "download", label: "Download qwen2.5:3b", cancelled: false, error: null, summary: null } } },
  },
  ollama: {
    unreachable: { ollama_status: { reachable: false, version: null, installed: [], recommended: recommended.map((model) => ({ ...model, installed: false })) } },
    noModel: { ollama_settings: { ...ollamaSettings, baseModel: null } },
    autoOff: { ollama_settings: { ...ollamaSettings, autoCategorize: false } },
  },
  startup: {
    backupFailed: { startup_status: { state: "backupFailed", reason: "The backup folder /media/usb/zeni-backups doesn't exist." } },
    newerData: { startup_status: { state: "newerData", version: "7.1.0" } },
    newerUnknown: { startup_status: { state: "newerData", version: null } },
  },
  update: {
    newer: { update_status: { ...upToDate, last: { date: "2026-11-15", result: { state: "newer", ...newer } }, banner: newer } },
    failed: { update_status: { ...upToDate, last: { date: "2026-11-15", result: { state: "failed", reason: "Couldn't reach GitHub: connection timed out" } } } },
    never: { update_status: { ...upToDate, last: null } },
    // Stays checking, so the poll keeps the spinner up.
    checking: { update_status: { ...upToDate, checking: true } },
    off: { update_status: { ...upToDate, checksEnabled: false } },
  },
  notes: { pending: { release_notes: { pending: notes, all: notes } } },
  notice: {
    ollama: { commit_import: { ...csvSummary, categorizeNotice: "Imported. Categorizing didn't start: Ollama isn't running." } },
  },
};

// The backend returns the updated layout; the UI only refetches the list.
fixtures.update_csv_layout = (fixtures.list_csv_layouts as unknown[])[0];

// `?status=needsSetup|locked|unlocked` (default unlocked), `?reason=<LockReason>` (default keyringLocked),
// `?undo=1` offers Undo restore when locked, `?keyringSaved=false` for the keyring-save failure in setup and status, `?codesLeft=<n>` (default 8).
export function securityStatus(params: URLSearchParams) {
  const keyringSaved = params.get("keyringSaved") !== "false";
  switch (params.get("status")) {
    case "needsSetup":
      return { state: "needsSetup", defaultOwner: "sam" };
    case "locked":
      return { state: "locked", reason: params.get("reason") ?? "keyringLocked", canUndoRestore: params.get("undo") === "1" };
    default:
      return { state: "unlocked", keyringSaved, recoveryCodesLeft: Number(params.get("codesLeft") ?? 8) };
  }
}

// The backend's message for each error kind used with `?fail=<command>:<kind>`; a `<command>:<kind>` key overrides the kind's for that command.
export const errorMessages: Record<string, string> = {
  WrongPassword: "That master password is incorrect.",
  InvalidRecoveryCode: "That recovery code isn't valid or was already used.",
  Locked: "Unlock Zeni first.",
  NotFound: "No account with that id.",
  Crypto: "A stored value failed to decrypt.",
  Validation: "Choose a different column for each role.",
  // The restore double failure (`?fail=restore_backup:Backup`).
  Backup: "Couldn't open the restored backup: Permission denied (os error 13). Putting your data back failed too, so your data is in the safety copy zeni-20261102-101500-safety.db in the backup folder.",
  "undo_restore:Backup": "That file is damaged, so it can't be restored. The restored data is still in place.",
  // sqlx's text for a busy database, the kind `backup_settings` really returns besides Locked.
  "backup_settings:Database": "error returned from database: (code: 5) database is locked",
  Import: "Zeni only imports US dollar statements; this file is in EUR.",
  Busy: "Categorize now is running. Wait for it to finish or cancel it.",
  "update_category:Busy": "Wait for categorizing to finish.",
  Ollama: "Ollama isn't running on port 11434. Start it with `ollama serve`.",
  "start_categorize:Ollama": "Pick a model in Settings first.",
  "add_category:Validation": "Enter a category name.",
  "set_transaction_category:NotFound": "That category no longer exists.",
  "update_nickname:NotFound": "That category no longer exists.",
  "save_nickname_rule:NotFound": "That category no longer exists.",
};
