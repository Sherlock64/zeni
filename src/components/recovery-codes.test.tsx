import { fireEvent, render, screen } from "@testing-library/react";
import { RecoveryCodes } from "@/components/recovery-codes";

const codes = ["7K3QD-M9X2A-PZ4TB-HN6WE", "Q2V8R-J5C1F-TY7GM-0KD3S"];
const writeText = vi.fn();
Object.defineProperty(navigator, "clipboard", { value: { writeText: (text: string) => writeText(text) } });
beforeEach(() => vi.resetAllMocks());

test("lists the codes and copies them one per line", async () => {
  writeText.mockResolvedValue(undefined);
  render(<RecoveryCodes codes={codes} onContinue={() => {}} />);
  expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(codes);
  expect(screen.getByText("Each code works once. Store them somewhere safe; they're shown only now.")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Copy codes" }));
  await vi.waitFor(() => expect(screen.getByRole("status").textContent).toBe("Copied to the clipboard."));
  expect(writeText).toHaveBeenCalledWith(codes.join("\n"));
});

test("says so when copying fails", async () => {
  writeText.mockRejectedValue(new Error("denied"));
  render(<RecoveryCodes codes={codes} onContinue={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Copy codes" }));
  await vi.waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Couldn't copy/));
});

test("continues only after the saved box is ticked", () => {
  const onContinue = vi.fn();
  render(<RecoveryCodes codes={codes} onContinue={onContinue} />);
  const button = screen.getByRole("button", { name: "Continue" });
  expect(button.getAttribute("aria-disabled")).toBe("true");

  fireEvent.click(button);
  expect(onContinue).not.toHaveBeenCalled();
  expect(screen.getByText("Save the codes and tick the box first.")).toBeTruthy();

  fireEvent.click(screen.getByRole("checkbox", { name: "I've saved these codes" }));
  expect(screen.queryByText("Save the codes and tick the box first.")).toBeNull();
  expect(button.getAttribute("aria-disabled")).toBe("false");
  fireEvent.click(button);
  expect(onContinue).toHaveBeenCalledTimes(1);
});
