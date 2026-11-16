import { formatBackupDate, formatSize } from "@/lib/backup-format";

test("formats a backup's local date and time to the minute", () => {
  expect(formatBackupDate("2026-11-15 14:03:22")).toBe("Nov 15, 2026 at 14:03");
  expect(formatBackupDate("2026-01-02 00:00:59")).toBe("Jan 2, 2026 at 00:00");
});

test("formats sizes in binary units", () => {
  expect(formatSize(0)).toBe("0 B");
  expect(formatSize(1023)).toBe("1023 B");
  expect(formatSize(1024)).toBe("1.0 KB");
  expect(formatSize(1843200)).toBe("1.8 MB");
  expect(formatSize(5 * 1024 ** 3)).toBe("5.0 GB");
  expect(formatSize(2048 * 1024 ** 3)).toBe("2048.0 GB");
});
