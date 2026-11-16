import { formatDate } from "@/lib/dates";

// "2026-11-15 14:03:22" (local) -> "Nov 15, 2026 at 14:03".
export const formatBackupDate = (createdAt: string) => `${formatDate(createdAt.slice(0, 10))} at ${createdAt.slice(11, 16)}`;

export function formatSize(bytes: number) {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return unit === 0 ? `${size} B` : `${size.toFixed(1)} ${units[unit]}`;
}
