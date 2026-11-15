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
    version: "0.1.0",
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
      { id: 101, importId: 1, postedDate: "2026-10-31", amountCents: -1850, description: "CORNER COFFEE ROASTERS", memo: "Card purchase 1234", transactionType: "POS", runningBalanceCents: null },
      { id: 100, importId: 1, postedDate: "2026-10-30", amountCents: 245000, description: "ACME CORP PAYROLL", memo: "Direct deposit", transactionType: "DIRECTDEP", runningBalanceCents: null },
      { id: 99, importId: 1, postedDate: "2026-10-29", amountCents: -8642, description: "GREENLEAF MARKET #42", memo: null, transactionType: null, runningBalanceCents: null },
      { id: 98, importId: 1, postedDate: "2026-10-28", amountCents: -12000, description: "CITY WATER UTILITY", memo: "Autopay ref 88213", transactionType: null, runningBalanceCents: null },
      { id: 97, importId: 1, postedDate: "2026-10-27", amountCents: -4599, description: "STREAMFLIX SUBSCRIPTION", memo: null, transactionType: null, runningBalanceCents: null },
      { id: 96, importId: 1, postedDate: "2026-10-26", amountCents: -6000, description: "ATM WITHDRAWAL 5TH AVE", memo: "Fee waived", transactionType: null, runningBalanceCents: null },
      { id: 95, importId: 1, postedDate: "2026-10-24", amountCents: 1525, description: "REFUND PAPER & INK CO", memo: null, transactionType: null, runningBalanceCents: null },
      { id: 94, importId: 1, postedDate: "2026-10-22", amountCents: -185000, description: "MAPLE STREET APARTMENTS", memo: "Rent October", transactionType: null, runningBalanceCents: null },
      { id: 93, importId: 1, postedDate: "2026-10-20", amountCents: -3275, description: "SHELL FUEL 0193", memo: null, transactionType: null, runningBalanceCents: null },
      { id: 92, importId: 1, postedDate: "2026-10-18", amountCents: -2210, description: "PIZZERIA NAPOLI", memo: null, transactionType: null, runningBalanceCents: null },
      { id: 91, importId: 1, postedDate: "2026-10-16", amountCents: -15000, description: "TRANSFER TO SAVINGS", memo: "Online transfer", transactionType: null, runningBalanceCents: null },
      { id: 90, importId: 1, postedDate: "2026-10-15", amountCents: 312, description: "INTEREST PAYMENT", memo: null, transactionType: null, runningBalanceCents: null },
    ],
    total: 57,
  },
};

const backups = [
  { fileName: "zeni-20261115-090012-daily.db", kind: "daily", createdAt: "2026-11-15 09:00:12", sizeBytes: 1843200 },
  { fileName: "zeni-20261114-183045-manual.db", kind: "manual", createdAt: "2026-11-14 18:30:45", sizeBytes: 1839104 },
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

// The backend's message for each error kind used with `?fail=<command>:<kind>`.
export const errorMessages: Record<string, string> = {
  WrongPassword: "That master password is incorrect.",
  InvalidRecoveryCode: "That recovery code isn't valid or was already used.",
  Locked: "Unlock Zeni first.",
  NotFound: "No account with that id.",
  Crypto: "A stored value failed to decrypt.",
  Validation: "Choose a different column for each role.",
  // Shown by the restore error snapshot (`?fail=restore_backup:Backup`).
  Backup: "That backup is from a newer version of Zeni. Update Zeni, then restore it.",
  Import: "Zeni only imports US dollar statements; this file is in EUR.",
};
