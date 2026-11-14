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
    importId: 3,
    fileName: "checking-2026-10.qfx",
    format: "qfx",
    added: 12,
    duplicates: 3,
    balanceCheck: "passed",
    ledgerBalanceCents: 482317,
    expectedBalanceCents: 482317,
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
    },
  ],
  revert_import: null,
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

// `?status=needsSetup|locked|unlocked` (default unlocked), `?reason=<LockReason>` (default keyringLocked),
// `?keyringSaved=false` for the keyring-save failure in setup and status, `?codesLeft=<n>` (default 8).
export function securityStatus(params: URLSearchParams) {
  const keyringSaved = params.get("keyringSaved") !== "false";
  switch (params.get("status")) {
    case "needsSetup":
      return { state: "needsSetup", defaultOwner: "sam" };
    case "locked":
      return { state: "locked", reason: params.get("reason") ?? "keyringLocked" };
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
  Import: "Zeni only imports US dollar statements; this file is in EUR.",
};
