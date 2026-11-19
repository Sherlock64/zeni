import { invoke, type InvokeArgs } from "@tauri-apps/api/core";
import type { Account } from "@/types/bindings/Account";
import type { AccountNumbers } from "@/types/bindings/AccountNumbers";
import type { AppInfo } from "@/types/bindings/AppInfo";
import type { BackupFile } from "@/types/bindings/BackupFile";
import type { BackupSettings } from "@/types/bindings/BackupSettings";
import type { BuildRequest } from "@/types/bindings/BuildRequest";
import type { Category } from "@/types/bindings/Category";
import type { CommitImportRequest } from "@/types/bindings/CommitImportRequest";
import type { ContinueStartupRequest } from "@/types/bindings/ContinueStartupRequest";
import type { CsvLayout } from "@/types/bindings/CsvLayout";
import type { CsvMapping } from "@/types/bindings/CsvMapping";
import type { CsvPreviewRow } from "@/types/bindings/CsvPreviewRow";
import type { DeleteCategoryRequest } from "@/types/bindings/DeleteCategoryRequest";
import type { DeleteCsvLayoutRequest } from "@/types/bindings/DeleteCsvLayoutRequest";
import type { DeleteNicknameRequest } from "@/types/bindings/DeleteNicknameRequest";
import type { DeleteNicknameRuleRequest } from "@/types/bindings/DeleteNicknameRuleRequest";
import type { ImportRecord } from "@/types/bindings/ImportRecord";
import type { ImportStep } from "@/types/bindings/ImportStep";
import type { ImportSummary } from "@/types/bindings/ImportSummary";
import type { JobStatus } from "@/types/bindings/JobStatus";
import type { MarkReviewedRequest } from "@/types/bindings/MarkReviewedRequest";
import type { ModelBuild } from "@/types/bindings/ModelBuild";
import type { NewCategory } from "@/types/bindings/NewCategory";
import type { Nickname } from "@/types/bindings/Nickname";
import type { NicknameSettings } from "@/types/bindings/NicknameSettings";
import type { OllamaSettings } from "@/types/bindings/OllamaSettings";
import type { OllamaStatus } from "@/types/bindings/OllamaStatus";
import type { RecoverRequest } from "@/types/bindings/RecoverRequest";
import type { RecoveryCodes } from "@/types/bindings/RecoveryCodes";
import type { ReleaseNotes } from "@/types/bindings/ReleaseNotes";
import type { ReorderCategoriesRequest } from "@/types/bindings/ReorderCategoriesRequest";
import type { RestoreBackupRequest } from "@/types/bindings/RestoreBackupRequest";
import type { RevealAccountNumbersRequest } from "@/types/bindings/RevealAccountNumbersRequest";
import type { RevertImportRequest } from "@/types/bindings/RevertImportRequest";
import type { ReviewGroup } from "@/types/bindings/ReviewGroup";
import type { RuleInput } from "@/types/bindings/RuleInput";
import type { SampleErrorRequest } from "@/types/bindings/SampleErrorRequest";
import type { SaveCsvLayoutRequest } from "@/types/bindings/SaveCsvLayoutRequest";
import type { SaveNicknameRuleRequest } from "@/types/bindings/SaveNicknameRuleRequest";
import type { SecurityStatus } from "@/types/bindings/SecurityStatus";
import type { SetAutoCategorizeRequest } from "@/types/bindings/SetAutoCategorizeRequest";
import type { SetBackupRetentionRequest } from "@/types/bindings/SetBackupRetentionRequest";
import type { SetBaseModelRequest } from "@/types/bindings/SetBaseModelRequest";
import type { SetExamplesPerCategoryRequest } from "@/types/bindings/SetExamplesPerCategoryRequest";
import type { SetOllamaPortRequest } from "@/types/bindings/SetOllamaPortRequest";
import type { SetTransactionCategoryRequest } from "@/types/bindings/SetTransactionCategoryRequest";
import type { SetTransactionsCategoryRequest } from "@/types/bindings/SetTransactionsCategoryRequest";
import type { SetUpdateChecksRequest } from "@/types/bindings/SetUpdateChecksRequest";
import type { SetupRequest } from "@/types/bindings/SetupRequest";
import type { SetupResponse } from "@/types/bindings/SetupResponse";
import type { SpendingQuery } from "@/types/bindings/SpendingQuery";
import type { SpendingSummary } from "@/types/bindings/SpendingSummary";
import type { StartCategorizeRequest } from "@/types/bindings/StartCategorizeRequest";
import type { StartModelDownloadRequest } from "@/types/bindings/StartModelDownloadRequest";
import type { StartupStatus } from "@/types/bindings/StartupStatus";
import type { TransactionPage } from "@/types/bindings/TransactionPage";
import type { TransactionQuery } from "@/types/bindings/TransactionQuery";
import type { UnlockRequest } from "@/types/bindings/UnlockRequest";
import type { UpdateCategoryRequest } from "@/types/bindings/UpdateCategoryRequest";
import type { UpdateCsvLayoutRequest } from "@/types/bindings/UpdateCsvLayoutRequest";
import type { UpdateNicknameRequest } from "@/types/bindings/UpdateNicknameRequest";
import type { UpdateNicknameRuleRequest } from "@/types/bindings/UpdateNicknameRuleRequest";
import type { UpdateStatus } from "@/types/bindings/UpdateStatus";
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
export const backupSettings = () => call<BackupSettings>("backup_settings");
// Rust opens the folder picker; null means the user cancelled it.
export const chooseBackupFolder = () => call<BackupSettings | null>("choose_backup_folder");
export const setBackupRetention = (request: SetBackupRetentionRequest) =>
  call<BackupSettings>("set_backup_retention", { request });
export const backUpNow = () => call<BackupFile>("back_up_now");
export const listBackups = () => call<BackupFile[]>("list_backups");
// Rust opens the file picker; null means the user cancelled it.
export const pickRestoreFile = () => call<BackupFile | null>("pick_restore_file");
export const restoreBackup = (request: RestoreBackupRequest) => call<null>("restore_backup", { request });
export const undoRestore = () => call<null>("undo_restore");
export const listNicknames = () => call<Nickname[]>("list_nicknames");
export const saveNicknameRule = (request: SaveNicknameRuleRequest) => call<Nickname>("save_nickname_rule", { request });
export const countRuleMatches = (request: RuleInput) => call<number>("count_rule_matches", { request });
export const updateNickname = (request: UpdateNicknameRequest) => call<Nickname>("update_nickname", { request });
export const deleteNickname = (request: DeleteNicknameRequest) => call<null>("delete_nickname", { request });
export const updateNicknameRule = (request: UpdateNicknameRuleRequest) =>
  call<Nickname>("update_nickname_rule", { request });
export const deleteNicknameRule = (request: DeleteNicknameRuleRequest) =>
  call<null>("delete_nickname_rule", { request });
export const nicknameSettings = () => call<NicknameSettings>("nickname_settings");
export const setNicknameStaleDays = (request: NicknameSettings) =>
  call<NicknameSettings>("set_nickname_stale_days", { request });
export const listCategories = () => call<Category[]>("list_categories");
export const addCategory = (request: NewCategory) => call<Category>("add_category", { request });
export const updateCategory = (request: UpdateCategoryRequest) => call<Category>("update_category", { request });
export const reorderCategories = (request: ReorderCategoriesRequest) =>
  call<Category[]>("reorder_categories", { request });
export const deleteCategory = (request: DeleteCategoryRequest) => call<null>("delete_category", { request });
export const setTransactionCategory = (request: SetTransactionCategoryRequest) =>
  call<null>("set_transaction_category", { request });
export const setTransactionsCategory = (request: SetTransactionsCategoryRequest) =>
  call<number>("set_transactions_category", { request });
export const ollamaSettings = () => call<OllamaSettings>("ollama_settings");
export const setOllamaPort = (request: SetOllamaPortRequest) => call<OllamaSettings>("set_ollama_port", { request });
export const setBaseModel = (request: SetBaseModelRequest) => call<OllamaSettings>("set_base_model", { request });
export const setAutoCategorize = (request: SetAutoCategorizeRequest) =>
  call<OllamaSettings>("set_auto_categorize", { request });
export const setExamplesPerCategory = (request: SetExamplesPerCategoryRequest) =>
  call<OllamaSettings>("set_examples_per_category", { request });
export const ollamaStatus = () => call<OllamaStatus>("ollama_status");
export const startModelDownload = (request: StartModelDownloadRequest) =>
  call<JobStatus>("start_model_download", { request });
export const jobStatus = () => call<JobStatus>("job_status");
export const cancelJob = () => call<null>("cancel_job");
export const clearJobOutcome = () => call<null>("clear_job_outcome");
export const startCategorize = (request: StartCategorizeRequest) => call<JobStatus>("start_categorize", { request });
export const reviewGroups = () => call<ReviewGroup[]>("review_groups");
export const unreviewedCount = () => call<number>("unreviewed_count");
export const markReviewed = (request: MarkReviewedRequest) => call<null>("mark_reviewed", { request });
export const listBuilds = () => call<ModelBuild[]>("list_builds");
export const startBuild = () => call<JobStatus>("start_build");
export const activateBuild = (request: BuildRequest) => call<null>("activate_build", { request });
export const deleteBuild = (request: BuildRequest) => call<null>("delete_build", { request });
export const spendingSummary = (request: SpendingQuery) => call<SpendingSummary>("spending_summary", { request });
export const startupStatus = () => call<StartupStatus>("startup_status");
export const continueStartup = (request: ContinueStartupRequest) => call<StartupStatus>("continue_startup", { request });
export const updateStatus = () => call<UpdateStatus>("update_status");
export const checkForUpdates = () => call<UpdateStatus>("check_for_updates");
export const dismissUpdate = () => call<UpdateStatus>("dismiss_update");
export const setUpdateChecks = (request: SetUpdateChecksRequest) => call<UpdateStatus>("set_update_checks", { request });
export const releaseNotes = () => call<ReleaseNotes>("release_notes");
export const acknowledgeReleaseNotes = () => call<null>("acknowledge_release_notes");
