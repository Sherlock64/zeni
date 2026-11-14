import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { recover, resetSecurity, unlock } from "@/lib/commands";
import { recoveryCodeValid, UnlockPage } from "@/pages/unlock";
import type { LockReason } from "@/types/bindings/LockReason";

vi.mock("@/lib/commands", () => ({ unlock: vi.fn(), recover: vi.fn(), resetSecurity: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

function renderPage(reason: LockReason = "keyringLocked") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <UnlockPage reason={reason} />
    </QueryClientProvider>,
  );
  return invalidate;
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const errorOf = (label: string) => {
  const ids = screen.getByLabelText(label).getAttribute("aria-describedby") ?? "";
  return ids.split(" ").map((id) => document.getElementById(id)?.textContent).join(" ");
};

test.each([
  ["keyringLocked", "Your system keyring is locked"],
  ["keyringUnavailable", "Zeni couldn't reach your system keyring."],
  ["keyMissing", "Zeni's key isn't in your system keyring."],
] as const)("explains the %s reason", (reason, text) => {
  renderPage(reason);
  expect(screen.getByText(new RegExp(text))).toBeTruthy();
});

test("normalizes recovery codes like the backend", () => {
  expect(recoveryCodeValid("7k3qd-m9x2a-pz4tb-hn6we")).toBe(true);
  expect(recoveryCodeValid("7K3QD M9X2A PZ4TB HN6WE")).toBe(true);
  expect(recoveryCodeValid("7K3QD-M9X2A-PZ4TB-HN6WU")).toBe(false);
  expect(recoveryCodeValid("7K3QD-M9X2A-PZ4TB-HN6W")).toBe(false);
});

test("asks for a password before calling unlock", () => {
  renderPage();
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  expect(errorOf("Master password")).toBe("Enter your master password.");
  expect(screen.getByRole("alert").textContent).toBe("Enter your master password.");
  expect(unlock).not.toHaveBeenCalled();
});

test("shows a wrong password inline and returns focus to the field", async () => {
  vi.mocked(unlock).mockRejectedValue({ kind: "WrongPassword", message: "That master password is incorrect." });
  renderPage();
  type("Master password", "not my password");
  const button = screen.getByRole("button", { name: "Unlock" });
  button.focus();
  fireEvent.click(button);
  await vi.waitFor(() => expect(errorOf("Master password")).toBe("That master password is incorrect."));
  expect(document.activeElement).toBe(screen.getByLabelText("Master password"));
  // Shown inline, not in a CommandErrorAlert, and announced because focus may not move.
  expect(screen.getByRole("alert").textContent).toBe("That master password is incorrect.");
  expect(unlock).toHaveBeenCalledWith({ masterPassword: "not my password" }, expect.anything());
});

test("refetches the status after unlocking", async () => {
  vi.mocked(unlock).mockResolvedValue(null);
  const invalidate = renderPage();
  type("Master password", "correct horse battery");
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  await vi.waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["security_status"] }));
});

test("recovers with a code and a new password", async () => {
  vi.mocked(recover)
    .mockRejectedValueOnce({ kind: "InvalidRecoveryCode", message: "That recovery code isn't valid or was already used." })
    .mockResolvedValueOnce(null);
  const invalidate = renderPage();
  fireEvent.click(screen.getByRole("button", { name: "Use a recovery code" }));
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Use a recovery code" }));

  fireEvent.click(screen.getByRole("button", { name: "Set password and unlock" }));
  expect(errorOf("Recovery code")).toMatch("Enter a 20-character code");
  expect(errorOf("New master password")).toMatch("Use at least 12 characters.");
  expect(recover).not.toHaveBeenCalled();

  type("Recovery code", "7k3qd-m9x2a-pz4tb-hn6we");
  type("New master password", "a brand new password");
  type("Confirm new master password", "a brand new password");
  fireEvent.click(screen.getByRole("button", { name: "Set password and unlock" }));
  await vi.waitFor(() => expect(errorOf("Recovery code")).toBe("That recovery code isn't valid or was already used."));
  expect(document.activeElement).toBe(screen.getByLabelText("Recovery code"));

  fireEvent.click(screen.getByRole("button", { name: "Set password and unlock" }));
  await vi.waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["security_status"] }));
  expect(recover).toHaveBeenLastCalledWith({
    recoveryCode: "7k3qd-m9x2a-pz4tb-hn6we",
    newMasterPassword: "a brand new password",
  }, expect.anything());
});

test("erases only after confirming in the dialog", async () => {
  vi.mocked(resetSecurity).mockRejectedValueOnce({ kind: "Locked", message: "Unlock Zeni first." }).mockResolvedValueOnce(null);
  const invalidate = renderPage();
  fireEvent.click(screen.getByRole("button", { name: "Can't unlock?" }));
  const dialog = await screen.findByRole("alertdialog", { name: "Erase and set up again?" });
  expect(within(dialog).getByText(/Nobody can recover them/)).toBeTruthy();
  expect(resetSecurity).not.toHaveBeenCalled();

  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(resetSecurity).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Can't unlock?" }));
  const again = await screen.findByRole("alertdialog");
  fireEvent.click(within(again).getByRole("button", { name: "Erase and set up again" }));
  expect(await within(again).findByText("Couldn't erase")).toBeTruthy();

  fireEvent.click(within(again).getByRole("button", { name: "Erase and set up again" }));
  await vi.waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["security_status"] }));
  expect(resetSecurity).toHaveBeenCalledTimes(2);
});

// The busy button keeps focus (aria-disabled, not disabled) and a repeat press sends nothing.
async function expectBusy(name: string, command: unknown) {
  const button = await screen.findByRole("button", { name });
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect(button.hasAttribute("disabled")).toBe(false);
  fireEvent.click(button);
  expect(command).toHaveBeenCalledTimes(1);
}

test("marks Unlock busy and ignores repeat presses", async () => {
  vi.mocked(unlock).mockReturnValue(new Promise(() => {}));
  renderPage();
  type("Master password", "correct horse battery");
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  await expectBusy("Unlocking…", unlock);
});

test("marks recovery busy and ignores repeat presses", async () => {
  vi.mocked(recover).mockReturnValue(new Promise(() => {}));
  renderPage();
  fireEvent.click(screen.getByRole("button", { name: "Use a recovery code" }));
  type("Recovery code", "7k3qd-m9x2a-pz4tb-hn6we");
  type("New master password", "a brand new password");
  type("Confirm new master password", "a brand new password");
  fireEvent.click(screen.getByRole("button", { name: "Set password and unlock" }));
  await expectBusy("Unlocking…", recover);
});

test("marks Erase busy and ignores repeat presses", async () => {
  vi.mocked(resetSecurity).mockReturnValue(new Promise(() => {}));
  renderPage();
  fireEvent.click(screen.getByRole("button", { name: "Can't unlock?" }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Erase and set up again" }));
  await expectBusy("Erasing…", resetSecurity);
});
