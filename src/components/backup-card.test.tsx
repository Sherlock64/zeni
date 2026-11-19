import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { BackupCard } from "@/components/backup-card";
import {
  backupSettings,
  backUpNow,
  chooseBackupFolder,
  listBackups,
  pickRestoreFile,
  restoreBackup,
  setBackupRetention,
} from "@/lib/commands";
import type { BackupFile } from "@/types/bindings/BackupFile";

vi.mock("@/lib/commands", () => ({
  backupSettings: vi.fn(),
  chooseBackupFolder: vi.fn(),
  setBackupRetention: vi.fn(),
  backUpNow: vi.fn(),
  listBackups: vi.fn(),
  pickRestoreFile: vi.fn(),
  restoreBackup: vi.fn(),
}));

const settings = { folder: "/data/backups", isDefaultFolder: true, keepAutomatic: 14, dailyWarning: null };
const daily: BackupFile = {
  fileName: "zeni-20261115-090012-daily.db",
  path: "/data/backups/zeni-20261115-090012-daily.db",
  kind: "daily",
  createdAt: "2026-11-15 09:00:12",
  sizeBytes: 1843200,
};
const manual: BackupFile = {
  ...daily,
  fileName: "zeni-20261114-183045-manual.db",
  path: "/data/backups/zeni-20261114-183045-manual.db",
  kind: "manual",
  createdAt: "2026-11-14 18:30:45",
};
const preRevert: BackupFile = {
  ...daily,
  fileName: "zeni-20261113-120000-pre-revert.db",
  path: "/data/backups/zeni-20261113-120000-pre-revert.db",
  kind: "preRevert",
  createdAt: "2026-11-13 12:00:00",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(backupSettings).mockResolvedValue(settings);
  vi.mocked(listBackups).mockResolvedValue([daily, manual]);
});

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <BackupCard />
    </QueryClientProvider>,
  );
  return invalidate;
}

// The card has a polite status region for the list and settings, and one for the Back up now result.
const liveStatus = () => screen.getAllByRole("status")[0];
const never = () => new Promise<never>(() => {});

test("lists backups with date, kind and size, and the folder in use", async () => {
  vi.mocked(listBackups).mockResolvedValue([daily, manual, preRevert, { ...preRevert, fileName: "zeni-20261112-080000-pre-update.db", kind: "preUpdate", createdAt: "2026-11-12 08:00:00" }]);
  renderCard();
  expect(liveStatus().textContent).toBe("Loading backups…");
  const rows = await screen.findAllByRole("row");
  expect(rows.slice(1).map((row) => [...row.querySelectorAll("td")].slice(0, 3).map((cell) => cell.textContent))).toEqual([
    ["Nov 15, 2026 at 09:00", "Daily", "1.8 MB"],
    ["Nov 14, 2026 at 18:30", "Manual", "1.8 MB"],
    ["Nov 13, 2026 at 12:00", "Before revert", "1.8 MB"],
    ["Nov 12, 2026 at 08:00", "Before update", "1.8 MB"],
  ]);
  expect(screen.getByText("/data/backups")).toBeTruthy();
  expect(screen.getByText("(default)")).toBeTruthy();
  expect(screen.queryByText(/automatic backup didn't work/)).toBeNull();
});

test("shows an empty list", async () => {
  vi.mocked(listBackups).mockResolvedValue([]);
  renderCard();
  expect(await screen.findByText("No backups in this folder yet")).toBeTruthy();
});

test("shows a list error with a retry", async () => {
  vi.mocked(listBackups).mockRejectedValueOnce({ kind: "Backup", message: "Folder missing." }).mockResolvedValueOnce([daily]);
  renderCard();
  expect(await screen.findByText("Folder missing.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Daily")).toBeTruthy();
});

test("retries the list, keeping the error and button up and ignoring repeat presses, then focuses the heading", async () => {
  let finish: (value: BackupFile[]) => void = () => {};
  vi.mocked(listBackups)
    .mockRejectedValueOnce({ kind: "Backup", message: "Folder missing." })
    .mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
  renderCard();
  const retry = await screen.findByRole("button", { name: "Try again" });
  retry.focus();
  fireEvent.click(retry);
  await vi.waitFor(() => expect(retry.getAttribute("aria-disabled")).toBe("true"));
  expect(retry.textContent).toBe("Trying again…");
  expect(document.activeElement).toBe(retry);
  expect(screen.getByText("Folder missing.")).toBeTruthy();
  expect(liveStatus().textContent).toBe("Retrying…");
  fireEvent.click(retry);
  expect(listBackups).toHaveBeenCalledTimes(2);
  finish([daily]);
  expect(await screen.findByText("Daily")).toBeTruthy();
  expect(screen.queryByText("Folder missing.")).toBeNull();
  await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Backups" })));
});

test("keeps the list's Try again button focused when the retry fails again", async () => {
  vi.mocked(listBackups)
    .mockRejectedValueOnce({ kind: "Backup", message: "Folder missing." })
    .mockRejectedValueOnce({ kind: "Backup", message: "Still missing." });
  renderCard();
  const retry = await screen.findByRole("button", { name: "Try again" });
  retry.focus();
  fireEvent.click(retry);
  expect(await screen.findByText("Still missing.")).toBeTruthy();
  await vi.waitFor(() => expect(retry.getAttribute("aria-disabled")).toBe("false"));
  expect(retry.textContent).toBe("Try again");
  expect(document.activeElement).toBe(retry);
});

test("warns when today's daily backup failed", async () => {
  vi.mocked(backupSettings).mockResolvedValue({ ...settings, dailyWarning: "The folder doesn't exist." });
  renderCard();
  expect(await screen.findByText("Today's automatic backup didn't work")).toBeTruthy();
  expect(screen.getByText(/The folder doesn't exist\./)).toBeTruthy();
});

test("backs up now, shows the path and refreshes the list, ignoring repeat presses", async () => {
  let finish: (file: BackupFile) => void = () => {};
  vi.mocked(backUpNow).mockReturnValue(new Promise((resolve) => (finish = resolve)));
  const invalidate = renderCard();
  const button = screen.getByRole("button", { name: "Back up now" });
  fireEvent.click(button);
  const busy = await screen.findByRole("button", { name: "Backing up…" });
  expect(busy.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(busy);
  expect(backUpNow).toHaveBeenCalledTimes(1);
  finish(manual);
  expect(await screen.findByText(manual.path)).toBeTruthy();
  expect(screen.getByText("Backup saved")).toBeTruthy();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["list_backups"] });
});

test("shows a failed backup", async () => {
  vi.mocked(backUpNow).mockRejectedValue({ kind: "Backup", message: "The folder isn't writable." });
  renderCard();
  fireEvent.click(screen.getByRole("button", { name: "Back up now" }));
  expect(within(await screen.findByRole("alert")).getByText("Couldn't back up")).toBeTruthy();
});

test("changes the folder, and keeps it when the picker is cancelled", async () => {
  vi.mocked(chooseBackupFolder)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ ...settings, folder: "/media/usb", isDefaultFolder: false });
  renderCard();
  const button = await screen.findByRole("button", { name: "Change folder…" });
  fireEvent.click(button);
  await vi.waitFor(() => expect(chooseBackupFolder).toHaveBeenCalledTimes(1));
  expect(screen.getByText("/data/backups")).toBeTruthy();
  await vi.waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("false"));
  fireEvent.click(button);
  expect(await screen.findByText("/media/usb")).toBeTruthy();
  expect(screen.queryByText("(default)")).toBeNull();
});

test("ignores repeat presses while choosing a folder", async () => {
  vi.mocked(chooseBackupFolder).mockReturnValue(never());
  renderCard();
  fireEvent.click(await screen.findByRole("button", { name: "Change folder…" }));
  const busy = await screen.findByRole("button", { name: "Choosing…" });
  expect(busy.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(busy);
  expect(chooseBackupFolder).toHaveBeenCalledTimes(1);
});

test("saves how many automatic backups to keep, and shows a range error on the field", async () => {
  vi.mocked(setBackupRetention)
    .mockRejectedValueOnce({ kind: "Validation", message: "Keep between 1 and 365 automatic backups." })
    .mockResolvedValueOnce({ ...settings, keepAutomatic: 3 });
  renderCard();
  const input = (await screen.findByLabelText("Automatic backups to keep")) as HTMLInputElement;
  expect(input.value).toBe("14");
  fireEvent.change(input, { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Keep between 1 and 365 automatic backups.");
  fireEvent.change(input, { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Saved.")).toBeTruthy();
  expect(setBackupRetention).toHaveBeenLastCalledWith({ keepAutomatic: 3 }, expect.anything());
  expect(input.value).toBe("3");
  // An edit makes the confirmation stale.
  fireEvent.change(input, { target: { value: "4" } });
  expect(screen.queryByText("Saved.")).toBeNull();
});

test("ignores repeat presses while saving the setting", async () => {
  vi.mocked(setBackupRetention).mockReturnValue(never());
  renderCard();
  fireEvent.change(await screen.findByLabelText("Automatic backups to keep"), { target: { value: "7" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const busy = await screen.findByRole("button", { name: "Saving…" });
  expect(busy.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(busy);
  expect(setBackupRetention).toHaveBeenCalledTimes(1);
});

test("confirms a restore naming the date, then re-reads every query", async () => {
  let finish: (value: null) => void = () => {};
  vi.mocked(restoreBackup).mockReturnValue(new Promise((resolve) => (finish = resolve)));
  const invalidate = renderCard();
  const opener = await screen.findByRole("button", { name: "Restore the manual backup from Nov 14, 2026 at 18:30" });
  fireEvent.click(opener);
  const dialog = screen.getByRole("alertdialog");
  expect(within(dialog).getByRole("heading", { name: "Restore the backup from Nov 14, 2026 at 18:30?" })).toBeTruthy();
  expect(within(dialog).getByText("Your current data will be replaced. A safety copy is kept first.")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Replace my data" }));
  const busy = await within(dialog).findByRole("button", { name: "Restoring…" });
  expect(busy.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(busy);
  expect(within(dialog).getByRole("button", { name: "Cancel" }).getAttribute("aria-disabled")).toBe("true");
  expect(restoreBackup).toHaveBeenCalledTimes(1);
  expect(restoreBackup).toHaveBeenCalledWith({ source: { kind: "backup", fileName: manual.fileName } }, expect.anything());
  finish(null);
  await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(invalidate).toHaveBeenCalledWith();
  await vi.waitFor(() => expect(document.activeElement).toBe(opener));
  const restored =
    "Restored the backup from Nov 14, 2026 at 18:30. Your previous data is in the newest safety copy below; restore it to undo.";
  expect(liveStatus().textContent).toBe(restored);
  expect(screen.getByText("Backup restored")).toBeTruthy();
});

test("keeps the dialog open to show a failed restore", async () => {
  vi.mocked(restoreBackup).mockRejectedValue({ kind: "Backup", message: "That file isn't a Zeni backup. Your current data wasn't changed." });
  renderCard();
  fireEvent.click(await screen.findByRole("button", { name: "Restore the daily backup from Nov 15, 2026 at 09:00" }));
  fireEvent.click(screen.getByRole("button", { name: "Replace my data" }));
  const dialog = screen.getByRole("alertdialog");
  const alert = await within(dialog).findByRole("alert");
  expect(within(alert).getByText("That file isn't a Zeni backup. Your current data wasn't changed.")).toBeTruthy();
  expect(within(alert).getByText("Choose another backup, or check the backup folder.")).toBeTruthy();
});

test("shows the backend's message when putting the data back failed too", async () => {
  const message = "Couldn't open the restored backup: Permission denied (os error 13). Putting your data back failed too, so your data is in the safety copy zeni-20261102-101500-safety.db in the backup folder.";
  vi.mocked(restoreBackup).mockRejectedValue({ kind: "Backup", message });
  renderCard();
  fireEvent.click(await screen.findByRole("button", { name: "Restore the daily backup from Nov 15, 2026 at 09:00" }));
  fireEvent.click(screen.getByRole("button", { name: "Replace my data" }));
  const alert = await within(screen.getByRole("alertdialog")).findByRole("alert");
  expect(within(alert).getByText(message)).toBeTruthy();
  expect(within(alert).queryByText(/wasn't changed/)).toBeNull();
});

test("restores a picked file, and does nothing when the picker is cancelled", async () => {
  const picked: BackupFile = { ...daily, fileName: "copy.db", path: "/home/sam/copy.db", kind: "other", createdAt: "2026-10-30 21:12:05" };
  vi.mocked(pickRestoreFile).mockResolvedValueOnce(null).mockResolvedValueOnce(picked);
  vi.mocked(restoreBackup).mockResolvedValue(null);
  renderCard();
  const button = screen.getByRole("button", { name: "Restore from file…" });
  fireEvent.click(button);
  await vi.waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("false"));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  fireEvent.click(button);
  const dialog = await screen.findByRole("alertdialog");
  expect(within(dialog).getByRole("heading", { name: "Restore the backup from Oct 30, 2026 at 21:12?" })).toBeTruthy();
  // The description names the file; the full path is a separate line outside it.
  const description = document.getElementById(dialog.getAttribute("aria-describedby") ?? "");
  expect(description?.textContent).toBe("Zeni will restore copy.db. Your current data will be replaced. A safety copy is kept first.");
  const path = within(dialog).getByText("/home/sam/copy.db");
  expect(description?.contains(path)).toBe(false);
  fireEvent.click(within(dialog).getByRole("button", { name: "Replace my data" }));
  await vi.waitFor(() => expect(restoreBackup).toHaveBeenCalledWith({ source: { kind: "pickedFile" } }, expect.anything()));
});

test("ignores repeat presses while picking a file", async () => {
  vi.mocked(pickRestoreFile).mockReturnValue(never());
  renderCard();
  fireEvent.click(screen.getByRole("button", { name: "Restore from file…" }));
  const busy = await screen.findByRole("button", { name: "Choosing…" });
  expect(busy.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(busy);
  expect(pickRestoreFile).toHaveBeenCalledTimes(1);
});

const failure = { kind: "Backup", message: "The backup folder isn't writable." } as const;

test("shows a settings load error without the folder or keep field", async () => {
  vi.mocked(backupSettings).mockRejectedValue(failure);
  renderCard();
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't load backup settings")).toBeTruthy();
  expect(within(alert).getByText(failure.message)).toBeTruthy();
  expect(
    within(alert).getByText("Zeni couldn't read its settings just now. Try again; if it keeps failing, restart Zeni."),
  ).toBeTruthy();
  expect(screen.queryByText("Folder")).toBeNull();
  expect(screen.queryByLabelText("Automatic backups to keep")).toBeNull();
});

test("shows a failed folder change", async () => {
  vi.mocked(chooseBackupFolder).mockRejectedValue(failure);
  renderCard();
  fireEvent.click(await screen.findByRole("button", { name: "Change folder…" }));
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't change the backup folder")).toBeTruthy();
  expect(within(alert).getByText(failure.message)).toBeTruthy();
});

test("shows a failed retention save that isn't a range error", async () => {
  vi.mocked(setBackupRetention).mockRejectedValue(failure);
  renderCard();
  fireEvent.change(await screen.findByLabelText("Automatic backups to keep"), { target: { value: "7" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't save the setting")).toBeTruthy();
  expect(within(alert).getByText(failure.message)).toBeTruthy();
});

test("shows a failed file pick", async () => {
  vi.mocked(pickRestoreFile).mockRejectedValue(failure);
  renderCard();
  fireEvent.click(screen.getByRole("button", { name: "Restore from file…" }));
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't open the file")).toBeTruthy();
  expect(within(alert).getByText(failure.message)).toBeTruthy();
});

test("names each restore button with the backup's kind and date", async () => {
  const at = (kind: BackupFile["kind"], minute: string): BackupFile => ({
    ...daily,
    kind,
    fileName: `${kind}.db`,
    createdAt: `2026-11-15 09:${minute}:00`,
  });
  vi.mocked(listBackups).mockResolvedValue([
    at("manual", "01"),
    at("daily", "02"),
    at("preRevert", "03"),
    at("safety", "04"),
    at("other", "05"),
    at("preUpdate", "06"),
  ]);
  renderCard();
  await screen.findAllByRole("row");
  const names = screen.getAllByRole("button", { name: /^Restore the / }).map((button) => button.getAttribute("aria-label"));
  expect(names).toEqual([
    "Restore the manual backup from Nov 15, 2026 at 09:01",
    "Restore the daily backup from Nov 15, 2026 at 09:02",
    "Restore the before-revert backup from Nov 15, 2026 at 09:03",
    "Restore the safety copy from Nov 15, 2026 at 09:04",
    "Restore the backup from Nov 15, 2026 at 09:05",
    "Restore the before-update backup from Nov 15, 2026 at 09:06",
  ]);
});

test("retries loading the settings, ignoring repeat presses, and moves focus to the heading", async () => {
  let finish: (value: typeof settings) => void = () => {};
  vi.mocked(backupSettings)
    .mockRejectedValueOnce(failure)
    .mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
  renderCard();
  const retry = await screen.findByRole("button", { name: "Try again" });
  retry.focus();
  fireEvent.click(retry);
  // The last error and its button stay up while the retry runs.
  await vi.waitFor(() => expect(retry.getAttribute("aria-disabled")).toBe("true"));
  expect(retry.textContent).toBe("Trying again…");
  expect(document.activeElement).toBe(retry);
  expect(screen.getByText("Couldn't load backup settings")).toBeTruthy();
  expect(liveStatus().textContent).toBe("Retrying…");
  fireEvent.click(retry);
  expect(backupSettings).toHaveBeenCalledTimes(2);
  finish(settings);
  expect(await screen.findByLabelText("Automatic backups to keep")).toBeTruthy();
  expect(screen.queryByText("Couldn't load backup settings")).toBeNull();
  await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Backups" })));
});

test("keeps the Try again button focused when the settings retry fails again", async () => {
  vi.mocked(backupSettings)
    .mockRejectedValueOnce(failure)
    .mockRejectedValueOnce({ kind: "Backup", message: "Still missing." });
  renderCard();
  const retry = await screen.findByRole("button", { name: "Try again" });
  retry.focus();
  fireEvent.click(retry);
  expect(await screen.findByText("Still missing.")).toBeTruthy();
  await vi.waitFor(() => expect(retry.getAttribute("aria-disabled")).toBe("false"));
  expect(screen.getByRole("button", { name: "Try again" })).toBe(retry);
  expect(document.activeElement).toBe(retry);
  expect(liveStatus().textContent).toBe("");
});

test("clears the last action's message when another action in the card starts", async () => {
  vi.mocked(chooseBackupFolder).mockResolvedValue({ ...settings, folder: "/media/usb", isDefaultFolder: false });
  vi.mocked(backUpNow).mockResolvedValueOnce(manual).mockReturnValueOnce(never());
  vi.mocked(setBackupRetention).mockResolvedValue({ ...settings, keepAutomatic: 7 });
  vi.mocked(pickRestoreFile).mockReturnValue(never());
  renderCard();

  fireEvent.click(await screen.findByRole("button", { name: "Change folder…" }));
  await vi.waitFor(() => expect(liveStatus().textContent).toBe("Backup folder changed."));
  fireEvent.click(screen.getByRole("button", { name: "Back up now" }));
  await vi.waitFor(() => expect(liveStatus().textContent).toBe(""));
  expect(await screen.findByText("Backup saved")).toBeTruthy();

  fireEvent.change(screen.getByLabelText("Automatic backups to keep"), { target: { value: "7" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await vi.waitFor(() => expect(screen.queryByText("Backup saved")).toBeNull());
  expect(await screen.findByText("Saved.")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Restore from file…" }));
  await vi.waitFor(() => expect(screen.queryByText("Saved.")).toBeNull());
});

test("clears a restore's message when another action starts", async () => {
  vi.mocked(restoreBackup).mockResolvedValue(null);
  vi.mocked(backUpNow).mockReturnValue(never());
  renderCard();
  fireEvent.click(await screen.findByRole("button", { name: "Restore the daily backup from Nov 15, 2026 at 09:00" }));
  fireEvent.click(screen.getByRole("button", { name: "Replace my data" }));
  expect(await screen.findByText("Backup restored")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back up now" }));
  await vi.waitFor(() => expect(screen.queryByText("Backup restored")).toBeNull());
  expect(liveStatus().textContent).toBe("");
});
