// Dev-only entry for UI snapshots in a plain browser: answers IPC from fixtures instead of Rust.
// `?fail=<command>` (repeatable) makes that command reject, to show error states.
import { mockIPC } from "@tauri-apps/api/mocks";
import { fixtures } from "@/lib/snapshot-fixtures";

const failing = new URLSearchParams(location.search).getAll("fail");

mockIPC((command) => {
  if (failing.includes(command)) throw { kind: "Sample", message: `Snapshot failure for ${command}` };
  if (!(command in fixtures)) throw { kind: "Invoke", message: `No snapshot fixture for ${command}` };
  return fixtures[command];
});

await import("@/main");
