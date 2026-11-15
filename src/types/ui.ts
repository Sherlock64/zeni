import type { ComponentProps, ReactNode } from "react";
import type { Account } from "@/types/bindings/Account";
import type { BackupFile } from "@/types/bindings/BackupFile";
import type { CsvMapping } from "@/types/bindings/CsvMapping";
import type { CsvMappingNeeded } from "@/types/bindings/CsvMappingNeeded";
import type { ImportReview } from "@/types/bindings/ImportReview";
import type { ImportStep } from "@/types/bindings/ImportStep";
import type { ImportRecord } from "@/types/bindings/ImportRecord";
import type { ImportSummary } from "@/types/bindings/ImportSummary";
import type { LockReason } from "@/types/bindings/LockReason";
import type { RestoreSource } from "@/types/bindings/RestoreSource";
import type { TransactionQuery } from "@/types/bindings/TransactionQuery";
import type { TransactionSort } from "@/types/bindings/TransactionSort";
import type { CommandError } from "@/types/command";

export type PageProps = { title: string; description: string; children: ReactNode };

export type CommandErrorAlertProps = {
  title: string;
  error: CommandError;
  onDismiss?: () => void;
  // Replaces the error kind's default next step, where the fix is on screen.
  nextStep?: string;
};

export type InfoRowProps = { label: string; loading: boolean; children: ReactNode };

export type FieldErrors = Partial<Record<string, string>>;

export type TextFieldProps = ComponentProps<"input"> & {
  label: string;
  hint?: string;
  error?: string;
  // Announce the error as it appears, for fields that keep focus while it does.
  announce?: boolean;
};

export type RecoveryCodesProps = { codes: string[]; onContinue: () => void };

export type SetupPageProps = { defaultOwner: string };

export type UnlockPageProps = { reason: LockReason; canUndoRestore: boolean };

export type UndoRestoreProps = { onUndone: () => void };

export type GateScreenProps = { children: ReactNode };

export type AccountCardProps = { account: Account };

export type SecretValueProps = { value?: string };

export type SortHeaderProps = {
  column: TransactionSort;
  label: string;
  query: TransactionQuery;
  onSort: (column: TransactionSort) => void;
  className?: string;
};

export type ImportSummaryAlertProps = { summary: ImportSummary; onDismiss: () => void };

export type ImportListProps = { onReverted: (importId: number) => void };

export type BalanceFlagProps = { record: ImportRecord };

// A CSV mapping while it is being edited: required columns may still be unset (null).
export type CsvMappingDraft = Omit<CsvMapping, "postedDate" | "description" | "amount"> & {
  postedDate: number | null;
  description: number | null;
  amountKind: "signed" | "split";
  amount: number | null;
  debit: number | null;
  credit: number | null;
};

// A draft field that holds a column index.
export type CsvMappingColumn = Exclude<keyof CsvMappingDraft, "dateFormat" | "amountKind">;

export type CsvMappingFormProps = {
  headers: string[];
  value: CsvMappingDraft;
  // `mapping` is null while a required column is unset.
  onChange: (value: CsvMappingDraft, mapping: CsvMapping | null) => void;
  // Mark unset required columns as errors, after a save attempt.
  showRequired?: boolean;
};

export type CsvMappingDialogProps = {
  needed: CsvMappingNeeded;
  onStep: (step: ImportStep) => void;
  onCancel: () => void;
  cancelling: boolean;
  // The dialogs have no trigger, so the caller says where focus goes when they close.
  onCloseAutoFocus: (event: Event) => void;
};

// The mapping or review step waiting on the user, shown as a dialog.
export type PendingImportStep = Exclude<ImportStep, { step: "imported" }>;

export type DuplicateAnswer = "yes" | "no";

export type ImportCancelledProps = { fileName: string; onDismiss: () => void };

export type DuplicateReviewDialogProps = {
  review: ImportReview;
  onStep: (step: ImportStep) => void;
  onCancel: () => void;
  cancelling: boolean;
  // The dialogs have no trigger, so the caller says where focus goes when they close.
  onCloseAutoFocus: (event: Event) => void;
};

// The backup waiting on the restore confirm dialog.
export type RestoreTarget = { source: RestoreSource; file: BackupFile };
