import type { AppError } from "@/types/bindings/AppError";

/** An error from a command: a typed AppError from Rust, or an IPC failure that never reached Rust. */
export type CommandError = AppError | { kind: "Invoke"; message: string };

declare module "@tanstack/react-query" {
  interface Register {
    defaultError: CommandError;
  }
}
