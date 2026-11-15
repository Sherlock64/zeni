import { invoke, type InvokeArgs } from "@tauri-apps/api/core";
import type { Account } from "@/types/bindings/Account";
import type { AccountNumbers } from "@/types/bindings/AccountNumbers";
import type { AppInfo } from "@/types/bindings/AppInfo";
import type { CommitImportRequest } from "@/types/bindings/CommitImportRequest";
import type { CsvLayout } from "@/types/bindings/CsvLayout";
import type { CsvMapping } from "@/types/bindings/CsvMapping";
import type { CsvPreviewRow } from "@/types/bindings/CsvPreviewRow";
import type { DeleteCsvLayoutRequest } from "@/types/bindings/DeleteCsvLayoutRequest";
import type { ImportRecord } from "@/types/bindings/ImportRecord";
import type { ImportStep } from "@/types/bindings/ImportStep";
import type { ImportSummary } from "@/types/bindings/ImportSummary";
import type { RecoverRequest } from "@/types/bindings/RecoverRequest";
import type { RecoveryCodes } from "@/types/bindings/RecoveryCodes";
import type { RevealAccountNumbersRequest } from "@/types/bindings/RevealAccountNumbersRequest";
import type { RevertImportRequest } from "@/types/bindings/RevertImportRequest";
import type { SampleErrorRequest } from "@/types/bindings/SampleErrorRequest";
import type { SaveCsvLayoutRequest } from "@/types/bindings/SaveCsvLayoutRequest";
import type { SecurityStatus } from "@/types/bindings/SecurityStatus";
import type { SetupRequest } from "@/types/bindings/SetupRequest";
import type { SetupResponse } from "@/types/bindings/SetupResponse";
import type { TransactionPage } from "@/types/bindings/TransactionPage";
import type { TransactionQuery } from "@/types/bindings/TransactionQuery";
import type { UnlockRequest } from "@/types/bindings/UnlockRequest";
import type { UpdateCsvLayoutRequest } from "@/types/bindings/UpdateCsvLayoutRequest";
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
export const securityStatus = () => call<SecurityStatus>("security_status");
export const completeSetup = (request: SetupRequest) => call<SetupResponse>("complete_setup", { request });
export const unlock = (request: UnlockRequest) => call<null>("unlock", { request });
export const recover = (request: RecoverRequest) => call<null>("recover", { request });
export const resetSecurity = () => call<null>("reset_security");
export const regenerateRecoveryCodes = (request: UnlockRequest) =>
  call<RecoveryCodes>("regenerate_recovery_codes", { request });
export const listAccounts = () => call<Account[]>("list_accounts");
export const revealAccountNumbers = (request: RevealAccountNumbersRequest) =>
  call<AccountNumbers>("reveal_account_numbers", { request });
// Rust opens the file picker; null means the user cancelled it.
export const importFile = () => call<ImportStep | null>("import_file");
export const previewCsvMapping = (request: CsvMapping) =>
  call<CsvPreviewRow[]>("preview_csv_mapping", { request });
export const saveCsvLayout = (request: SaveCsvLayoutRequest) => call<ImportStep>("save_csv_layout", { request });
export const commitImport = (request: CommitImportRequest) => call<ImportSummary>("commit_import", { request });
export const cancelImport = () => call<null>("cancel_import");
export const listCsvLayouts = () => call<CsvLayout[]>("list_csv_layouts");
export const updateCsvLayout = (request: UpdateCsvLayoutRequest) =>
  call<CsvLayout>("update_csv_layout", { request });
export const deleteCsvLayout = (request: DeleteCsvLayoutRequest) => call<null>("delete_csv_layout", { request });
export const listImports = () => call<ImportRecord[]>("list_imports");
export const revertImport = (request: RevertImportRequest) => call<null>("revert_import", { request });
export const listTransactions = (request: TransactionQuery) =>
  call<TransactionPage>("list_transactions", { request });
