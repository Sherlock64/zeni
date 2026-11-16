import type { CommandError } from "@/types/command";

// Which field a Validation message belongs to, by the wording of src-tauri/src/nicknames.rs:
// name: "Enter a nickname.", "Nicknames can be at most … characters.", "A nickname named … already exists."
// pattern: "Enter a pattern.", "Patterns can be at most … characters.", "That regex isn't valid: …"
export function errorField(error: CommandError | null) {
  if (error?.kind !== "Validation") return null;
  if (/^(Enter a nickname|Nicknames can be|A nickname named)/.test(error.message)) return "name";
  if (/^(Enter a pattern|Patterns can be|That regex isn't valid)/.test(error.message)) return "pattern";
  return null;
}
