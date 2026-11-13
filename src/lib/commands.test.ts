import { invoke } from "@tauri-apps/api/core";
import { appInfo, sampleError } from "@/lib/commands";

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
