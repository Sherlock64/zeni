import { invoke } from "@tauri-apps/api/core";
import {
  appInfo,
  backUpNow,
  backupSettings,
  cancelImport,
  chooseBackupFolder,
  commitImport,
  completeSetup,
  countRuleMatches,
  deleteCsvLayout,
  deleteNickname,
  deleteNicknameRule,
  importFile,
  listAccounts,
  listBackups,
  listCsvLayouts,
  listImports,
  listNicknames,
  listTransactions,
  nicknameSettings,
  pickRestoreFile,
  previewCsvMapping,
  recover,
  regenerateRecoveryCodes,
  resetSecurity,
  restoreBackup,
  revealAccountNumbers,
  revertImport,
  sampleError,
  saveCsvLayout,
  saveNicknameRule,
  securityStatus,
  setBackupRetention,
  setNicknameStaleDays,
  undoRestore,
  unlock,
  updateCsvLayout,
  updateNickname,
  updateNicknameRule,
} from "@/lib/commands";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockInvoke = vi.mocked(invoke);

beforeEach(() => vi.resetAllMocks());

test("resolves with the command's response", async () => {
  const info = { name: "Zeni", version: "0.1.0", dbPath: "/tmp/zeni.db", migrationsApplied: 1 };
  mockInvoke.mockResolvedValueOnce(info);
  await expect(appInfo()).resolves.toEqual(info);
  expect(mockInvoke).toHaveBeenCalledWith("app_info", undefined);
});

test("passes a Rust AppError through as a typed error", async () => {
  mockInvoke.mockRejectedValueOnce({ kind: "Sample", message: "boom" });
  await expect(sampleError({ reason: "test" })).rejects.toEqual({ kind: "Sample", message: "boom" });
  expect(mockInvoke).toHaveBeenCalledWith("sample_error", { request: { reason: "test" } });
});

test("maps any other rejection to an Invoke error", async () => {
  mockInvoke.mockRejectedValueOnce("command app_info not found");
  await expect(appInfo()).rejects.toEqual({ kind: "Invoke", message: "command app_info not found" });
});

test("maps an object without a message to an Invoke error", async () => {
  mockInvoke.mockRejectedValueOnce({ kind: "Sample" });
  await expect(appInfo()).rejects.toEqual({ kind: "Invoke", message: '{"kind":"Sample"}' });
});

test("uses an Error's message, and a fallback when the rejection can't be encoded", async () => {
  mockInvoke.mockRejectedValueOnce(new Error("IPC down"));
  await expect(appInfo()).rejects.toEqual({ kind: "Invoke", message: "IPC down" });

  const circular: Record<string, unknown> = {};
  circular.self = circular;
  mockInvoke.mockRejectedValueOnce(circular);
  await expect(appInfo()).rejects.toEqual({ kind: "Invoke", message: "Unknown error" });

  mockInvoke.mockRejectedValueOnce(undefined);
  await expect(appInfo()).rejects.toEqual({ kind: "Invoke", message: "Unknown error" });
});

test("security and account wrappers invoke their commands with the request", async () => {
  const account = {
    name: "Checking",
    owner: "Me",
    bankName: "Test Bank",
    accountNumber: "0000",
    routingNumber: "000000000",
  };
  const cases: [() => Promise<unknown>, string, unknown, unknown][] = [
    [securityStatus, "security_status", undefined, { state: "needsSetup", defaultOwner: "Me" }],
    [
      () => completeSetup({ masterPassword: "pw", account }),
      "complete_setup",
      { request: { masterPassword: "pw", account } },
      { recoveryCodes: [], keyringSaved: false },
    ],
    [() => unlock({ masterPassword: "pw" }), "unlock", { request: { masterPassword: "pw" } }, null],
    [
      () => recover({ recoveryCode: "code", newMasterPassword: "pw" }),
      "recover",
      { request: { recoveryCode: "code", newMasterPassword: "pw" } },
      null,
    ],
    [resetSecurity, "reset_security", undefined, null],
    [
      () => regenerateRecoveryCodes({ masterPassword: "pw" }),
      "regenerate_recovery_codes",
      { request: { masterPassword: "pw" } },
      { codes: [] },
    ],
    [listAccounts, "list_accounts", undefined, []],
    [
      () => revealAccountNumbers({ accountId: 1 }),
      "reveal_account_numbers",
      { request: { accountId: 1 } },
      { accountNumber: "0000", routingNumber: "000000000" },
    ],
  ];
  for (const [run, command, args, response] of cases) {
    mockInvoke.mockResolvedValueOnce(response);
    await expect(run()).resolves.toEqual(response);
    expect(mockInvoke).toHaveBeenLastCalledWith(command, args);
  }
});

test("import and transaction wrappers invoke their commands with the request", async () => {
  const query = {
    from: "2026-10-01",
    to: null,
    search: "coffee",
    sort: "date",
    direction: "desc",
    page: 0,
    pageSize: 50,
  } as const;
  const cases: [() => Promise<unknown>, string, unknown, unknown][] = [
    [importFile, "import_file", undefined, null],
    [listImports, "list_imports", undefined, []],
    [() => revertImport({ importId: 3 }), "revert_import", { request: { importId: 3 } }, null],
    [() => listTransactions(query), "list_transactions", { request: query }, { rows: [], total: 0 }],
  ];
  for (const [run, command, args, response] of cases) {
    mockInvoke.mockResolvedValueOnce(response);
    await expect(run()).resolves.toEqual(response);
    expect(mockInvoke).toHaveBeenLastCalledWith(command, args);
  }
});

test("CSV import and layout wrappers invoke their commands with the request", async () => {
  const mapping = {
    dateFormat: "MM/DD/YYYY",
    postedDate: 0,
    description: 1,
    amount: { kind: "signed", column: 2 },
    transactionId: null,
    memo: null,
    transactionType: null,
    runningBalance: null,
    postingStatus: null,
    bankCategory: null,
  } as const;
  const layout = { id: 4, name: "Bank", headers: ["posting date", "description", "amount"], mapping };
  const needsMapping = { step: "needsMapping", data: { fileName: "a.csv", headers: [], rows: [] } };
  const cases: [() => Promise<unknown>, string, unknown, unknown][] = [
    [importFile, "import_file", undefined, needsMapping],
    [() => previewCsvMapping(mapping), "preview_csv_mapping", { request: mapping }, []],
    [
      () => saveCsvLayout({ name: "Bank", mapping }),
      "save_csv_layout",
      { request: { name: "Bank", mapping } },
      { step: "review", data: { fileName: "a.csv", format: "csv", pairs: [] } },
    ],
    [() => commitImport({ skipRows: [1] }), "commit_import", { request: { skipRows: [1] } }, { importId: 2 }],
    [cancelImport, "cancel_import", undefined, null],
    [listCsvLayouts, "list_csv_layouts", undefined, [layout]],
    [
      () => updateCsvLayout({ layoutId: 4, name: "Bank", mapping }),
      "update_csv_layout",
      { request: { layoutId: 4, name: "Bank", mapping } },
      layout,
    ],
    [() => deleteCsvLayout({ layoutId: 4 }), "delete_csv_layout", { request: { layoutId: 4 } }, null],
  ];
  for (const [run, command, args, response] of cases) {
    mockInvoke.mockResolvedValueOnce(response);
    await expect(run()).resolves.toEqual(response);
    expect(mockInvoke).toHaveBeenLastCalledWith(command, args);
  }
});

test("backup wrappers invoke their commands with the request", async () => {
  const settings = { folder: "/b", isDefaultFolder: true, keepAutomatic: 14, dailyWarning: null };
  const file = {
    fileName: "zeni-20261115-140322-manual.db",
    path: "/b/zeni-20261115-140322-manual.db",
    kind: "manual",
    createdAt: "2026-11-15 14:03:22",
    sizeBytes: 4096,
  };
  const cases: [() => Promise<unknown>, string, unknown, unknown][] = [
    [backupSettings, "backup_settings", undefined, settings],
    [chooseBackupFolder, "choose_backup_folder", undefined, null],
    [
      () => setBackupRetention({ keepAutomatic: 7 }),
      "set_backup_retention",
      { request: { keepAutomatic: 7 } },
      settings,
    ],
    [backUpNow, "back_up_now", undefined, file],
    [listBackups, "list_backups", undefined, [file]],
    [pickRestoreFile, "pick_restore_file", undefined, null],
    [
      () => restoreBackup({ source: { kind: "backup", fileName: file.fileName } }),
      "restore_backup",
      { request: { source: { kind: "backup", fileName: file.fileName } } },
      null,
    ],
    [
      () => restoreBackup({ source: { kind: "pickedFile" } }),
      "restore_backup",
      { request: { source: { kind: "pickedFile" } } },
      null,
    ],
    [undoRestore, "undo_restore", undefined, null],
  ];
  for (const [run, command, args, response] of cases) {
    mockInvoke.mockResolvedValueOnce(response);
    await expect(run()).resolves.toEqual(response);
    expect(mockInvoke).toHaveBeenLastCalledWith(command, args);
  }
});

test("nickname wrappers invoke their commands with the request", async () => {
  const rule = { mode: "exact", field: "description", pattern: "corner coffee" } as const;
  const nickname = {
    id: 1,
    name: "Coffee",
    enabled: true,
    staleExempt: false,
    matchCount: 2,
    lastMatched: "2026-10-31",
    stale: false,
    rules: [{ id: 4, nicknameId: 1, ...rule, matchCount: 2, lastMatched: "2026-10-31" }],
  };
  const update = { id: 1, name: "Cafe", enabled: false, staleExempt: true };
  const cases: [() => Promise<unknown>, string, unknown, unknown][] = [
    [listNicknames, "list_nicknames", undefined, [nickname]],
    [
      () => saveNicknameRule({ name: "Coffee", rule }),
      "save_nickname_rule",
      { request: { name: "Coffee", rule } },
      nickname,
    ],
    [() => countRuleMatches(rule), "count_rule_matches", { request: rule }, 2],
    [() => updateNickname(update), "update_nickname", { request: update }, nickname],
    [() => deleteNickname({ id: 1 }), "delete_nickname", { request: { id: 1 } }, null],
    [() => updateNicknameRule({ id: 4, rule }), "update_nickname_rule", { request: { id: 4, rule } }, nickname],
    [() => deleteNicknameRule({ id: 4 }), "delete_nickname_rule", { request: { id: 4 } }, null],
    [nicknameSettings, "nickname_settings", undefined, { staleDays: 90 }],
    [
      () => setNicknameStaleDays({ staleDays: 30 }),
      "set_nickname_stale_days",
      { request: { staleDays: 30 } },
      { staleDays: 30 },
    ],
  ];
  for (const [run, command, args, response] of cases) {
    mockInvoke.mockResolvedValueOnce(response);
    await expect(run()).resolves.toEqual(response);
    expect(mockInvoke).toHaveBeenLastCalledWith(command, args);
  }
});
