import { invoke, type InvokeArgs } from "@tauri-apps/api/core";
import type { AppInfo } from "@/types/bindings/AppInfo";
import type { SampleErrorRequest } from "@/types/bindings/SampleErrorRequest";
import type { CommandError } from "@/types/command";

function toCommandError(error: unknown): CommandError {
  if (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    typeof error.kind === "string" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error as CommandError;
  }
  return { kind: "Invoke", message: describe(error) };
}

function describe(error: unknown): string {
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  try {
    return JSON.stringify(error) ?? "Unknown error";
  } catch {
    return "Unknown error";
  }
}

async function call<T>(command: string, args?: InvokeArgs): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toCommandError(error);
  }
}

export const appInfo = () => call<AppInfo>("app_info");
export const sampleError = (request: SampleErrorRequest) => call<null>("sample_error", { request });
