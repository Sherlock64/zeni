const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

// Formats a "YYYY-MM-DD" posted date, like "Oct 31, 2026", without shifting it by the local time zone.
export const formatDate = (date: string) => dateFormat.format(new Date(`${date}T00:00:00Z`));
