import { render, screen } from "@testing-library/react";
import { TransactionsPage } from "@/pages/transactions";

test("shows the empty state", () => {
  render(<TransactionsPage />);
  expect(screen.getByRole("heading", { name: "Transactions" })).toBeTruthy();
  expect(screen.getByRole("heading", { level: 2, name: "No transactions yet" })).toBeTruthy();
});
