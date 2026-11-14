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
    migrationsApplied: 2,
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
};
