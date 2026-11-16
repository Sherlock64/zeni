// Dev-only entry for UI snapshots in a plain browser: answers IPC from fixtures instead of Rust.
// `?accounts=empty` answers list_accounts with no accounts, `?imports=empty` list_imports with no imports,
// `?layouts=empty` list_csv_layouts with no layouts, `?transactions=empty` list_transactions with an empty page, `?balances=1` list_transactions with running balances, `?import=cancel` import_file with null (picker cancelled),
// and `?import=mapping|review|csv|mismatch` import_file with the mapping dialog, the review dialog, or a CSV summary (running balance passed or mismatch).
// `?nicknames=empty` answers list_nicknames with no nicknames.
// `?fail=<command>[:<kind>]` (repeatable) makes that command reject, to show error states (kind defaults to Sample);
// the message is that command's own for the kind when it has one (`errorMessages["<command>:<kind>"]`), else the kind's.
// Steps run in URL order once the app has loaded, to reach states behind a click:
// `?fill=<input name>=<value>` types into the input with that name,
// `?click=<text>` clicks the button or menu item (`role=menuitem`) with that text or `aria-label`,
// `?contextmenu=<text>` right-clicks the table row whose text contains it (opens its context menu).
import { mockIPC } from "@tauri-apps/api/mocks";
import type { TransactionPage } from "@/types/bindings/TransactionPage";
import { errorMessages, fixtures, importSteps, securityStatus } from "@/lib/snapshot-fixtures";

const params = new URLSearchParams(location.search);
const failing = new Map(params.getAll("fail").map((entry) => entry.split(":") as [string, string | undefined]));
const responses: Record<string, unknown> = { ...fixtures, security_status: securityStatus(params) };
if (params.get("keyringSaved") === "false") responses.complete_setup = { ...(fixtures.complete_setup as object), keyringSaved: false };

if (params.get("accounts") === "empty") responses.list_accounts = [];
if (params.get("imports") === "empty") responses.list_imports = [];
if (params.get("layouts") === "empty") responses.list_csv_layouts = [];
if (params.get("nicknames") === "empty") responses.list_nicknames = [];
if (params.get("transactions") === "empty") responses.list_transactions = { rows: [], total: 0 };
if (params.get("balances") === "1") {
  // Rows are newest first, so each older balance is the newer one minus the newer row's amount.
  let balance = 421337;
  const page = fixtures.list_transactions as TransactionPage;
  responses.list_transactions = {
    ...page,
    rows: page.rows.map((row) => {
      const withBalance = { ...row, runningBalanceCents: balance };
      balance -= row.amountCents;
      return withBalance;
    }),
  };
}
const importParam = params.get("import");
if (importParam === "cancel") responses.import_file = null;
else if (importParam && importParam in importSteps) responses.import_file = importSteps[importParam];

mockIPC((command) => {
  if (failing.has(command)) {
    const kind = failing.get(command) || "Sample";
    throw { kind, message: errorMessages[`${command}:${kind}`] ?? errorMessages[kind] ?? `Snapshot failure for ${command}` };
  }
  if (!(command in responses)) throw { kind: "Invoke", message: `No snapshot fixture for ${command}` };
  // A successful undo leaves no restore to undo.
  if (command === "undo_restore") responses.security_status = { ...(responses.security_status as object), canUndoRestore: false };
  return responses[command];
});

await import("@/main");

async function waitFor<T>(find: () => T | null | undefined): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const found = find();
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Snapshot step target not found");
}

const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
for (const [key, value] of params) {
  if (key === "fill") {
    const [name, ...rest] = value.split("=");
    const input = await waitFor(() => document.querySelector<HTMLInputElement>(`input[name="${name}"]`));
    setValue.call(input, rest.join("="));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  } else if (key === "click") {
    const target = await waitFor(() =>
      [...document.querySelectorAll<HTMLElement>("button, [role=menuitem]")].find(
        (element) => element.textContent?.trim() === value || element.getAttribute("aria-label") === value,
      ),
    );
    // Radix menu triggers open on pointerdown, not click.
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    target.click();
  } else if (key === "contextmenu") {
    const row = await waitFor(() => [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes(value)));
    const { left, top, height } = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: left + 40, clientY: top + height / 2 }));
  }
}
