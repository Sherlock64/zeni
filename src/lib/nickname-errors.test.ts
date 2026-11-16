import { describe, expect, it } from "vitest";
import { errorField } from "@/lib/nickname-errors";

const validation = (message: string) => ({ kind: "Validation", message }) as const;

describe("errorField", () => {
  it.each([
    "Enter a nickname.",
    "Nicknames can be at most 100 characters.",
    'A nickname named "gas" already exists.',
  ])("routes %s to name", (message) => {
    expect(errorField(validation(message))).toBe("name");
  });

  it.each([
    "Enter a pattern.",
    "Patterns can be at most 500 characters.",
    "That regex isn't valid: unclosed group",
  ])("routes %s to pattern", (message) => {
    expect(errorField(validation(message))).toBe("pattern");
  });

  it("returns null for no error, another kind, or an unmatched message", () => {
    expect(errorField(null)).toBeNull();
    expect(errorField({ kind: "Invoke", message: "Enter a nickname." })).toBeNull();
    expect(errorField(validation("Stale days must be 1 to 3650."))).toBeNull();
  });
});
