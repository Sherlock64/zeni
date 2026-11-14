// Dev-only entry for UI snapshots in a plain browser: answers IPC from fixtures instead of Rust.
// `?accounts=empty` answers list_accounts with no accounts.
// `?fail=<command>[:<kind>]` (repeatable) makes that command reject, to show error states (kind defaults to Sample).
// Steps run in URL order once the app has loaded, to reach states behind a click:
// `?fill=<input name>=<value>` types into the input with that name, `?click=<text>` clicks the button with that text.
import { mockIPC } from "@tauri-apps/api/mocks";
import { errorMessages, fixtures, securityStatus } from "@/lib/snapshot-fixtures";

const params = new URLSearchParams(location.search);
const failing = new Map(params.getAll("fail").map((entry) => entry.split(":") as [string, string | undefined]));
const responses: Record<string, unknown> = { ...fixtures, security_status: securityStatus(params) };
if (params.get("keyringSaved") === "false") responses.complete_setup = { ...(fixtures.complete_setup as object), keyringSaved: false };

if (params.get("accounts") === "empty") responses.list_accounts = [];

mockIPC((command) => {
  if (failing.has(command)) {
    const kind = failing.get(command) || "Sample";
    throw { kind, message: errorMessages[kind] ?? `Snapshot failure for ${command}` };
  }
  if (!(command in responses)) throw { kind: "Invoke", message: `No snapshot fixture for ${command}` };
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
    const button = await waitFor(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === value));
    button.click();
  }
}
