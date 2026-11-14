import { invoke } from "@tauri-apps/api/core";
import {
  appInfo,
  completeSetup,
  listAccounts,
  recover,
  regenerateRecoveryCodes,
  resetSecurity,
  revealAccountNumbers,
  sampleError,
  securityStatus,
  unlock,
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
