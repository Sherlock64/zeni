import { formatCents } from "@/lib/money";

test("formats integer cents as US dollars", () => {
  expect(formatCents(245000)).toBe("$2,450.00");
  expect(formatCents(-1850)).toBe("-$18.50");
  expect(formatCents(5)).toBe("$0.05");
  expect(formatCents(0)).toBe("$0.00");
});
