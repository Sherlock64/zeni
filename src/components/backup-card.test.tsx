import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { BackupCard, formatSize } from "@/components/backup-card";
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

test("formats sizes", () => {
  expect(formatSize(512)).toBe("512 B");
  expect(formatSize(1843200)).toBe("1.8 MB");
});

test("lists backups with date, kind and size, and the folder in use", async () => {
  renderCard();
  expect(liveStatus().textContent).toBe("Loading backups…");
  const rows = await screen.findAllByRole("row");
  expect(rows.slice(1).map((row) => [...row.querySelectorAll("td")].slice(0, 3).map((cell) => cell.textContent))).toEqual([
    ["Nov 15, 2026 at 09:00", "Daily", "1.8 MB"],
    ["Nov 14, 2026 at 18:30", "Manual", "1.8 MB"],
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
  await vi.waitFor(() => expect(liveStatus().textContent).toBe("Saved. Zeni keeps 3 automatic backups."));
  expect(setBackupRetention).toHaveBeenLastCalledWith({ keepAutomatic: 3 }, expect.anything());
  expect(input.value).toBe("3");
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
  const opener = await screen.findByRole("button", { name: "Restore the backup from Nov 14, 2026 at 18:30" });
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
  vi.mocked(restoreBackup).mockRejectedValue({ kind: "Backup", message: "That file isn't a Zeni backup." });
  renderCard();
  fireEvent.click(await screen.findByRole("button", { name: "Restore the backup from Nov 15, 2026 at 09:00" }));
  fireEvent.click(screen.getByRole("button", { name: "Replace my data" }));
  const dialog = screen.getByRole("alertdialog");
  const alert = await within(dialog).findByRole("alert");
  expect(within(alert).getByText("That file isn't a Zeni backup.")).toBeTruthy();
  expect(within(alert).getByText("Your current data wasn't changed. Choose another backup, or check the backup folder.")).toBeTruthy();
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
  expect(within(dialog).getByText("/home/sam/copy.db")).toBeTruthy();
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
