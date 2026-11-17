import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  appInfo,
  nicknameSettings,
  regenerateRecoveryCodes,
  sampleError,
  securityStatus,
  setNicknameStaleDays,
} from "@/lib/commands";
import { SettingsPage } from "@/pages/settings";
import type { AppInfo } from "@/types/bindings/AppInfo";

// The layouts, backup and Ollama cards have their own tests and status regions.
vi.mock("@/components/csv-layouts-card", () => ({ CsvLayoutsCard: () => null }));
vi.mock("@/components/backup-card", () => ({ BackupCard: () => null }));
vi.mock("@/components/ollama-card", () => ({ OllamaCard: () => null }));
vi.mock("@/lib/commands", () => ({
  appInfo: vi.fn(),
  sampleError: vi.fn(),
  securityStatus: vi.fn(),
  regenerateRecoveryCodes: vi.fn(),
  nicknameSettings: vi.fn(),
  setNicknameStaleDays: vi.fn(),
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(securityStatus).mockResolvedValue({ state: "unlocked", keyringSaved: true, recoveryCodesLeft: 8 });
  vi.mocked(nicknameSettings).mockResolvedValue({ staleDays: 90 });
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

const aboutCard = () => within(screen.getByRole("heading", { name: "About" }).closest<HTMLElement>("[data-slot=card]")!);
const valueOf = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent;

test("shows a loading status, then every app info value", async () => {
  vi.mocked(appInfo).mockResolvedValue(info);
  renderPage();
  const status = aboutCard().getByRole("status");
  expect(status.textContent).toBe("Loading app info…");

  await screen.findByText("/data/zeni.db");
  expect(valueOf("Name")).toBe("Zeni");
  expect(valueOf("Version")).toBe("0.1.0");
  expect(valueOf("Database")).toBe("/data/zeni.db");
  expect(valueOf("Migrations applied")).toBe("1");
  expect(aboutCard().getByRole("status")).toBe(status);
  expect(status.textContent).toBe("");
});

test("shows a typed Invoke error, retries once while busy, then focuses the loaded section", async () => {
  let resolveRetry: (value: AppInfo) => void = () => {};
  vi.mocked(appInfo)
    .mockRejectedValueOnce(invokeError)
    .mockReturnValueOnce(new Promise((resolve) => (resolveRetry = resolve)));
  renderPage();
  const status = aboutCard().getByRole("status");
  const alert = await screen.findByRole("alert");
  expect(status.textContent).toBe("");
  expect(within(alert).getByText("Couldn't load app info")).toBeTruthy();
  expect(within(alert).getByText("Invoke")).toBeTruthy();
  expect(within(alert).getByText("not running in Tauri")).toBeTruthy();
  expect(within(alert).getByText(invokeHint)).toBeTruthy();

  const retry = screen.getByRole("button", { name: "Try again" });
  fireEvent.click(retry);
  await vi.waitFor(() => expect(status.textContent).toBe("Retrying…"));
  expect(aboutCard().getByRole("status")).toBe(status);
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

const staleField = () => screen.findByLabelText("Flag nicknames as stale after (days)");
const nicknamesCard = () => within(screen.getByRole("heading", { name: "Nicknames" }).closest<HTMLElement>("[data-slot=card]")!);

test("shows the stale days setting and saves a new value", async () => {
  vi.mocked(appInfo).mockResolvedValue(info);
  vi.mocked(setNicknameStaleDays).mockResolvedValue({ staleDays: 30 });
  const invalidate = renderPage();
  const field = (await staleField()) as HTMLInputElement;
  expect(field.value).toBe("90");
  fireEvent.change(field, { target: { value: "30" } });
  fireEvent.click(nicknamesCard().getByRole("button", { name: "Save" }));
  expect(await nicknamesCard().findByText("Saved.")).toBeTruthy();
  expect(vi.mocked(setNicknameStaleDays).mock.calls[0][0]).toEqual({ staleDays: 30 });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["list_nicknames"] });
  expect(field.value).toBe("30");
});

test.each(["0", "3651", "1.5", ""])("rejects %j inline without saving", async (value) => {
  vi.mocked(appInfo).mockResolvedValue(info);
  renderPage();
  const field = await staleField();
  fireEvent.change(field, { target: { value } });
  fireEvent.click(nicknamesCard().getByRole("button", { name: "Save" }));
  expect(field.getAttribute("aria-invalid")).toBe("true");
  expect(nicknamesCard().getByRole("alert").textContent).toBe("Stale days must be 1 to 3650.");
  expect(setNicknameStaleDays).not.toHaveBeenCalled();
  fireEvent.change(field, { target: { value: "5" } });
  expect(field.getAttribute("aria-invalid")).toBeNull();
});

test("shows a backend validation error under the field and other errors in an alert", async () => {
  vi.mocked(appInfo).mockResolvedValue(info);
  vi.mocked(setNicknameStaleDays)
    .mockRejectedValueOnce({ kind: "Validation", message: "Stale days must be 1 to 3650." })
    .mockRejectedValueOnce(invokeError);
  renderPage();
  const field = await staleField();
  const save = nicknamesCard().getByRole("button", { name: "Save" });
  fireEvent.click(save);
  await waitFor(() => expect(field.getAttribute("aria-invalid")).toBe("true"));

  fireEvent.click(save);
  const alert = await nicknamesCard().findByText("Couldn't save the setting");
  expect(alert.closest("[role=alert]")?.textContent).toContain(invokeHint);
  expect(field.getAttribute("aria-invalid")).toBeNull();
  expect(nicknamesCard().queryByText("Saved.")).toBeNull();
});

test("marks Save busy while saving and ignores repeat presses", async () => {
  vi.mocked(appInfo).mockResolvedValue(info);
  vi.mocked(setNicknameStaleDays).mockReturnValue(new Promise(() => {}));
  renderPage();
  await staleField();
  fireEvent.click(nicknamesCard().getByRole("button", { name: "Save" }));
  const busy = await nicknamesCard().findByRole("button", { name: "Saving…" });
  expect(busy.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(busy);
  expect(setNicknameStaleDays).toHaveBeenCalledTimes(1);
});

test.each(["1", "3650"])("saves the boundary value %s", async (value) => {
  vi.mocked(appInfo).mockResolvedValue(info);
  vi.mocked(setNicknameStaleDays).mockResolvedValue({ staleDays: Number(value) });
  renderPage();
  fireEvent.change(await staleField(), { target: { value } });
  fireEvent.click(nicknamesCard().getByRole("button", { name: "Save" }));
  expect(await nicknamesCard().findByText("Saved.")).toBeTruthy();
  expect(vi.mocked(setNicknameStaleDays).mock.calls[0][0]).toEqual({ staleDays: Number(value) });
});

test("shows no stale days field or Save while the setting loads", async () => {
  vi.mocked(appInfo).mockResolvedValue(info);
  vi.mocked(nicknameSettings).mockReturnValue(new Promise(() => {}));
  renderPage();
  await screen.findByText("/data/zeni.db");
  expect(screen.queryByLabelText("Flag nicknames as stale after (days)")).toBeNull();
  expect(nicknamesCard().getByRole("status").textContent).toBe("Loading nickname settings…");
  expect(nicknamesCard().queryByRole("button", { name: "Save" })).toBeNull();
});

test("shows an error when the stale days setting can't load, retries once while busy, then focuses the card", async () => {
  vi.mocked(appInfo).mockResolvedValue(info);
  let resolveRetry: (value: { staleDays: number }) => void = () => {};
  vi.mocked(nicknameSettings)
    .mockRejectedValueOnce(invokeError)
    .mockReturnValueOnce(new Promise((resolve) => (resolveRetry = resolve)));
  renderPage();
  expect((await screen.findByText("Couldn't load nickname settings")).closest("[role=alert]")).toBeTruthy();
  expect(screen.queryByLabelText("Flag nicknames as stale after (days)")).toBeNull();

  const retry = nicknamesCard().getByRole("button", { name: "Try again" });
  retry.focus();
  fireEvent.click(retry);
  await vi.waitFor(() => expect(retry.getAttribute("aria-disabled")).toBe("true"));
  expect(retry.hasAttribute("disabled")).toBe(false);
  expect(retry.textContent).toBe("Trying again…");
  expect(document.activeElement).toBe(retry);
  expect(nicknamesCard().getByText("Couldn't load nickname settings")).toBeTruthy();
  expect(nicknamesCard().getByRole("status").textContent).toBe("Retrying…");
  fireEvent.click(retry);
  expect(nicknameSettings).toHaveBeenCalledTimes(2);

  resolveRetry({ staleDays: 90 });
  expect(((await staleField()) as HTMLInputElement).value).toBe("90");
  expect(nicknamesCard().getByRole("status").textContent).toBe("");
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Nicknames" }));
});

test("remounts the nickname settings alert when a retry fails again", async () => {
  vi.mocked(appInfo).mockResolvedValue(info);
  vi.mocked(nicknameSettings).mockRejectedValue(invokeError);
  renderPage();
  const firstAlert = (await screen.findByText("Couldn't load nickname settings")).closest("[role=alert]");
  const retry = nicknamesCard().getByRole("button", { name: "Try again" });
  retry.focus();
  fireEvent.click(retry);
  await vi.waitFor(() =>
    expect(nicknamesCard().getByText("Couldn't load nickname settings").closest("[role=alert]")).not.toBe(firstAlert),
  );
  expect(nicknameSettings).toHaveBeenCalledTimes(2);
  await vi.waitFor(() => expect(retry.getAttribute("aria-disabled")).toBe("false"));
  expect(retry.textContent).toBe("Try again");
  expect(document.activeElement).toBe(retry);
});
