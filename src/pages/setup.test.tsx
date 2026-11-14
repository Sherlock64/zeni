import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { completeSetup } from "@/lib/commands";
import { routingNumberValid, SetupPage } from "@/pages/setup";

vi.mock("@/lib/commands", () => ({ completeSetup: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

const codes = Array.from({ length: 8 }, (_, i) => `AAAAA-BBBBB-CCCCC-DDDD${i}`);

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <SetupPage defaultOwner="sam" />
    </QueryClientProvider>,
  );
  return invalidate;
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const errorOf = (label: string) => {
  const ids = screen.getByLabelText(label).getAttribute("aria-describedby") ?? "";
  return ids.split(" ").map((id) => document.getElementById(id)?.textContent).join(" ");
};

function fillValid() {
  type("Master password", "correct horse battery");
  type("Confirm master password", "correct horse battery");
  type("Bank name", "Example Bank");
  type("Account number", "000123456789");
  type("Routing number", "011000015");
}

test("checks routing numbers with the ABA checksum", () => {
  expect(routingNumberValid("011000015")).toBe(true);
  expect(routingNumberValid("0110 00015")).toBe(true);
  expect(routingNumberValid("011000016")).toBe(false);
  expect(routingNumberValid("01100001")).toBe(false);
});

test("shows every validation error on submit, focuses the first, and doesn't call the backend", () => {
  renderPage();
  type("Account name", " ");
  fireEvent.click(screen.getByRole("button", { name: "Set up Zeni" }));
  expect(errorOf("Master password")).toBe("Use at least 12 characters.");
  expect(errorOf("Account name")).toBe("Enter an account name.");
  expect(errorOf("Bank name")).toBe("Enter the bank name.");
  expect(errorOf("Account number")).toBe("Use 4 to 17 digits.");
  expect(errorOf("Routing number")).toBe("Enter a valid 9-digit routing number.");
  expect(screen.getByLabelText("Owner").getAttribute("aria-invalid")).toBeNull();
  expect(document.activeElement).toBe(screen.getByLabelText("Master password"));
  expect(completeSetup).not.toHaveBeenCalled();

  type("Master password", "correct horse battery");
  type("Confirm master password", "correct horse batterz");
  expect(errorOf("Confirm master password")).toBe("The passwords don't match.");
});

test("submits, shows the recovery codes, and refetches the status only on continue", async () => {
  vi.mocked(completeSetup).mockResolvedValue({ recoveryCodes: codes, keyringSaved: true });
  const invalidate = renderPage();
  fillValid();
  fireEvent.click(screen.getByRole("button", { name: "Set up Zeni" }));

  const heading = await screen.findByRole("heading", { name: "Save your recovery codes" });
  expect(document.activeElement).toBe(heading);
  expect(completeSetup).toHaveBeenCalledWith({
    masterPassword: "correct horse battery",
    account: {
      name: "Checking",
      owner: "sam",
      bankName: "Example Bank",
      accountNumber: "000123456789",
      routingNumber: "011000015",
    },
  }, expect.anything());
  expect(within(screen.getByRole("list", { name: "Recovery codes" })).getAllByRole("listitem")).toHaveLength(8);
  expect(screen.queryByText(/ask for your master password each time/)).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(invalidate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: "I've saved these codes" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["security_status"] });
});

test("warns when the keyring didn't save the key", async () => {
  vi.mocked(completeSetup).mockResolvedValue({ recoveryCodes: codes, keyringSaved: false });
  renderPage();
  fillValid();
  fireEvent.click(screen.getByRole("button", { name: "Set up Zeni" }));
  expect(await screen.findByText("Zeni will ask for your master password each time it starts.")).toBeTruthy();
});

test("marks Set up busy and ignores repeat presses", async () => {
  vi.mocked(completeSetup).mockReturnValue(new Promise(() => {}));
  renderPage();
  fillValid();
  fireEvent.click(screen.getByRole("button", { name: "Set up Zeni" }));
  const button = await screen.findByRole("button", { name: "Setting up…" });
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect(button.hasAttribute("disabled")).toBe(false);
  fireEvent.click(button);
  expect(completeSetup).toHaveBeenCalledTimes(1);
});

test("shows a backend error", async () => {
  vi.mocked(completeSetup).mockRejectedValue({ kind: "Validation", message: "bankName must be 1..=100 chars" });
  renderPage();
  fillValid();
  fireEvent.click(screen.getByRole("button", { name: "Set up Zeni" }));
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Couldn't set up Zeni")).toBeTruthy();
  expect(within(alert).getByText("bankName must be 1..=100 chars")).toBeTruthy();
});
