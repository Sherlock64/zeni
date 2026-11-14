import type { FieldErrors } from "@/types/ui";

// Mirrors the backend's rules for fast feedback; the backend still validates. Counts characters, not UTF-16 units.
export function masterPasswordErrors(password: string, confirm: string, field = "masterPassword"): FieldErrors {
  const length = [...password].length;
  if (length < 12) return { [field]: "Use at least 12 characters." };
  if (length > 1024) return { [field]: "Use at most 1024 characters." };
  if (confirm !== password) return { [`${field}Confirm`]: "The passwords don't match." };
  return {};
}
