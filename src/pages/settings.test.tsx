import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { appInfo, regenerateRecoveryCodes, sampleError, securityStatus } from "@/lib/commands";
import { SettingsPage } from "@/pages/settings";
import type { AppInfo } from "@/types/bindings/AppInfo";

vi.mock("@/lib/commands", () => ({
  appInfo: vi.fn(),
  sampleError: vi.fn(),
  securityStatus: vi.fn(),
  regenerateRecoveryCodes: vi.fn(),
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(securityStatus).mockResolvedValue({ state: "unlocked", keyringSaved: true, recoveryCodesLeft: 8 });
});

const info = { name: "Zeni", version: "0.1.0", dbPath: "/data/zeni.db", migrationsApplied: 1 };
const invokeError = { kind: "Invoke", message: "not running in Tauri" } as const;
const invokeHint = "The request never reached Zeni's backend. Restart Zeni and try again.";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>,
  );
  return vi.spyOn(client, "invalidateQueries");
}

const valueOf = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent;

test("shows a loading status, then every app info value", async () => {
  vi.mocked(appInfo).mockResolvedValue(info);
  renderPage();
  const status = screen.getByRole("status");
  expect(status.textContent).toBe("Loading app info…");

  await screen.findByText("/data/zeni.db");
  expect(valueOf("Name")).toBe("Zeni");
  expect(valueOf("Version")).toBe("0.1.0");
  expect(valueOf("Database")).toBe("/data/zeni.db");
  expect(valueOf("Migrations applied")).toBe("1");
  expect(screen.getByRole("status")).toBe(status);
  expect(status.textContent).toBe("");
});

test("shows a typed Invoke error, retries once while busy, then focuses the loaded section", async () => {
  let resolveRetry: (value: AppInfo) => void = () => {};
  vi.mocked(appInfo)
    .mockRejectedValueOnce(invokeError)
    .mockReturnValueOnce(new Promise((resolve) => (resolveRetry = resolve)));
  renderPage();
  const status = screen.getByRole("status");
  const alert = await screen.findByRole("alert");
  expect(status.textContent).toBe("");
  expect(within(alert).getByText("Couldn't load app info")).toBeTruthy();
  expect(within(alert).getByText("Invoke")).toBeTruthy();
  expect(within(alert).getByText("not running in Tauri")).toBeTruthy();
  expect(within(alert).getByText(invokeHint)).toBeTruthy();

  const retry = screen.getByRole("button", { name: "Try again" });
  fireEvent.click(retry);
  await vi.waitFor(() => expect(status.textContent).toBe("Retrying…"));
  expect(screen.getByRole("status")).toBe(status);
  expect(retry.getAttribute("aria-disabled")).toBe("true");
  expect(retry.hasAttribute("disabled")).toBe(false);
  fireEvent.click(retry);
  expect(appInfo).toHaveBeenCalledTimes(2);

  resolveRetry(info);
  expect(await screen.findByText("/data/zeni.db")).toBeTruthy();
  expect(status.textContent).toBe("");
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "About" }));
});

test("remounts the alert when a retry fails again, so it is announced again", async () => {
  vi.mocked(appInfo).mockRejectedValue(invokeError);
  renderPage();
  const firstAlert = await screen.findByRole("alert");

  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await vi.waitFor(() => expect(screen.getByRole("alert")).not.toBe(firstAlert));
  expect(appInfo).toHaveBeenCalledTimes(2);
});

test("shows the kind and message of the sample error from Rust", async () => {
  vi.mocked(appInfo).mockResolvedValue(info);
  vi.mocked(sampleError).mockRejectedValue({ kind: "Sample", message: "Sample error: triggered from Settings" });
  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "Trigger sample error" }));
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Sample")).toBeTruthy();
  expect(within(alert).getByText("Sample error: triggered from Settings")).toBeTruthy();
  expect(within(alert).queryByText(invokeHint)).toBeNull();
  expect(sampleError).toHaveBeenCalledWith({ reason: "triggered from Settings" });
});

test("marks the sample error button busy without disabling it", async () => {
  vi.mocked(appInfo).mockResolvedValue(info);
  vi.mocked(sampleError).mockReturnValue(new Promise(() => {}));
  renderPage();

  const button = screen.getByRole("button", { name: "Trigger sample error" });
  fireEvent.click(button);
  await vi.waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("true"));
  expect(button.hasAttribute("disabled")).toBe(false);

  fireEvent.click(button);
  expect(sampleError).toHaveBeenCalledTimes(1);
});

const codes = ["AAAAA-AAAAA-AAAAA-AAAAA", "BBBBB-BBBBB-BBBBB-BBBBB"];
const security = (keyringSaved: boolean, recoveryCodesLeft: number) =>
  vi.mocked(securityStatus).mockResolvedValue({ state: "unlocked", keyringSaved, recoveryCodesLeft });

test("shows that the key is in the keyring and how many recovery codes are left", async () => {
  vi.mocked(appInfo).mockReturnValue(new Promise(() => {}));
  renderPage();
  expect(await screen.findByText("Key saved in your system keyring")).toBeTruthy();
  expect(valueOf("Recovery codes left")).toBe("8");
  expect(screen.queryByText(/recovery codes? left$/)).toBeNull();
});

test("says Zeni asks for the master password when the key isn't in the keyring", async () => {
  vi.mocked(appInfo).mockReturnValue(new Promise(() => {}));
  security(false, 8);
  renderPage();
  expect(await screen.findByText(/Not in your keyring — Zeni asks for your master password/)).toBeTruthy();
});

test.each([
  [2, "Only 2 recovery codes left"],
  [1, "Only 1 recovery code left"],
  [0, "No recovery codes left"],
])("warns when %i recovery codes are left", async (left, title) => {
  vi.mocked(appInfo).mockReturnValue(new Promise(() => {}));
  security(true, left);
  renderPage();
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText(title)).toBeTruthy();
  expect(valueOf("Recovery codes left")).toBe(String(left));
});

async function openRegenerate() {
  vi.mocked(appInfo).mockReturnValue(new Promise(() => {}));
  const invalidate = renderPage();
  await screen.findByText("Key saved in your system keyring");
  fireEvent.click(screen.getByRole("button", { name: "Generate new recovery codes" }));
  const dialog = await screen.findByRole("alertdialog");
  expect(within(dialog).getByText(/all your old codes stop working/)).toBeTruthy();
  expect(document.activeElement).toBe(within(dialog).getByLabelText("Master password"));
  return { dialog: within(dialog), invalidate };
}

const typePassword = (value: string) =>
  fireEvent.change(screen.getByLabelText("Master password"), { target: { value } });

test("asks for the master password before generating codes", async () => {
  const { dialog } = await openRegenerate();
  fireEvent.click(dialog.getByRole("button", { name: "Generate codes" }));
  expect(dialog.getByRole("alert").textContent).toBe("Enter your master password.");
  expect(document.activeElement).toBe(screen.getByLabelText("Master password"));
  expect(regenerateRecoveryCodes).not.toHaveBeenCalled();
});

test("shows a wrong password inline and focuses the field", async () => {
  vi.mocked(regenerateRecoveryCodes).mockRejectedValue({ kind: "WrongPassword", message: "That master password is incorrect." });
  const { dialog } = await openRegenerate();
  typePassword("not my password");
  fireEvent.click(dialog.getByRole("button", { name: "Generate codes" }));
  const field = screen.getByLabelText("Master password");
  await vi.waitFor(() => expect(field.getAttribute("aria-invalid")).toBe("true"));
  expect(document.getElementById(field.getAttribute("aria-describedby")!)?.textContent).toBe(
    "That master password is incorrect.",
  );
  expect(document.activeElement).toBe(field);
  // Focus was already in the field, so the error is announced as an alert.
  expect(dialog.getByRole("alert").textContent).toBe("That master password is incorrect.");
});

test("shows other errors in an alert", async () => {
  vi.mocked(regenerateRecoveryCodes).mockRejectedValue({ kind: "Locked", message: "Unlock Zeni first." });
  const { dialog } = await openRegenerate();
  typePassword("correct horse battery");
  fireEvent.click(dialog.getByRole("button", { name: "Generate codes" }));
  const alert = await dialog.findByRole("alert");
  expect(within(alert).getByText("Couldn't generate recovery codes")).toBeTruthy();
  expect(within(alert).getByText("Locked")).toBeTruthy();
});

test("marks Generate codes busy and ignores repeat presses", async () => {
  vi.mocked(regenerateRecoveryCodes).mockReturnValue(new Promise(() => {}));
  const { dialog } = await openRegenerate();
  typePassword("correct horse battery");
  fireEvent.click(dialog.getByRole("button", { name: "Generate codes" }));
  const button = await dialog.findByRole("button", { name: "Generating…" });
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect(button.hasAttribute("disabled")).toBe(false);
  fireEvent.click(button);
  expect(regenerateRecoveryCodes).toHaveBeenCalledTimes(1);
});

test("shows the new codes, stays open until Continue, then refreshes the status", async () => {
  vi.mocked(regenerateRecoveryCodes).mockResolvedValue({ codes });
  const { dialog, invalidate } = await openRegenerate();
  typePassword("correct horse battery");
  fireEvent.click(dialog.getByRole("button", { name: "Generate codes" }));

  const title = await dialog.findByRole("heading", { name: "Save your new recovery codes" });
  expect(regenerateRecoveryCodes).toHaveBeenCalledWith({ masterPassword: "correct horse battery" }, expect.anything());
  expect(document.activeElement).toBe(title);
  const list = dialog.getByRole("list", { name: "Recovery codes" });
  expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual(codes);

  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.getByRole("alertdialog")).toBeTruthy();

  fireEvent.click(dialog.getByRole("checkbox", { name: "I've saved these codes" }));
  fireEvent.click(dialog.getByRole("button", { name: "Continue" }));
  await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["security_status"] });
});

test("cancelling clears the password", async () => {
  const { dialog } = await openRegenerate();
  typePassword("secret password");
  fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
  await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Generate new recovery codes" }));
  expect(((await screen.findByLabelText("Master password")) as HTMLInputElement).value).toBe("");
});
