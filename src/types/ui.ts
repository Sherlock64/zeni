import type { ComponentProps, ReactNode } from "react";
import type { Account } from "@/types/bindings/Account";
import type { BackupFile } from "@/types/bindings/BackupFile";
import type { Category } from "@/types/bindings/Category";
import type { CsvMapping } from "@/types/bindings/CsvMapping";
import type { CsvMappingNeeded } from "@/types/bindings/CsvMappingNeeded";
import type { ImportRecord } from "@/types/bindings/ImportRecord";
import type { ImportReview } from "@/types/bindings/ImportReview";
import type { ImportStep } from "@/types/bindings/ImportStep";
import type { ImportSummary } from "@/types/bindings/ImportSummary";
import type { Nickname } from "@/types/bindings/Nickname";
import type { NicknameRule } from "@/types/bindings/NicknameRule";
import type { RestoreSource } from "@/types/bindings/RestoreSource";
import type { ReviewGroup } from "@/types/bindings/ReviewGroup";
import type { RuleInput } from "@/types/bindings/RuleInput";
import type { Transaction } from "@/types/bindings/Transaction";
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

export type NicknameRuleFieldsProps = {
  value: RuleInput;
  onChange: (rule: RuleInput) => void;
  // A pattern error from a failed save; replaces the live count's own regex error.
  error?: string;
};

export type RuleMatchCountProps = { rule: RuleInput };

export type RenameDialogProps = {
  transaction: Transaction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The dialog has no trigger, so the caller says where focus goes when it closes.
  onCloseAutoFocus: (event: Event) => void;
};

export type CategorizeDialogProps = {
  transaction: Transaction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The dialog has no trigger, so the caller says where focus goes when it closes.
  onCloseAutoFocus: (event: Event) => void;
};

// What the Nicknames page's form dialog is adding or editing.
export type NicknameDialogTarget =
  | { kind: "add" }
  | { kind: "rename"; nickname: Nickname }
  | { kind: "addRule"; nickname: Nickname }
  | { kind: "editRule"; nickname: Nickname; rule: NicknameRule };

export type NicknameFormDialogProps = {
  target: NicknameDialogTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The dialog has no trigger, so the caller says where focus goes when it closes.
  onCloseAutoFocus: (event: Event) => void;
};

// A nickname, or one of its rules, waiting on the delete confirm dialog.
export type NicknameDeleteTarget = { nickname: Nickname; rule?: NicknameRule };

export type NicknameMatchesProps = { count: number; last: string | null };

export type NicknameMenuItem = {
  label: string;
  // Gets the menu's trigger, so a dialog the item opens can return focus to it.
  onSelect: (trigger: HTMLElement) => void;
  destructive?: boolean;
  // Marks the item unavailable and is shown under its label.
  disabledReason?: string;
};

export type NicknameRowMenuProps = { label: string; items: NicknameMenuItem[]; menuFor?: number };

export type CategorySelectProps = {
  // Adds an option with this label for no category (value null), for example "Uncategorized" or "Leave uncategorized".
  uncategorizedLabel?: string;
  // Leaves this category out, for example the one being deleted.
  excludeId?: number;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  disabled?: boolean;
  // Mounts the list already open, for a control swapped in when the user activates it.
  defaultOpen?: boolean;
} & (
  | { allLabel?: undefined; value: number | null; onChange: (value: number | null) => void }
  // A first option with this label for every category, for example "All categories"; it is value undefined.
  | { allLabel: string; value: number | null | undefined; onChange: (value: number | null | undefined) => void }
);

export type ReviewCategoryCellProps = { row: Transaction; onChange: (categoryId: number | null) => void };

export type ReviewRowProps = {
  row: Transaction;
  selected: boolean;
  onSelect: (on: boolean) => void;
  // Selects every row with this row's nickname or description, in every group.
  onSelectLike: () => void;
  onChange: (categoryId: number | null) => void;
};

export type ReviewGroupSectionProps = {
  group: ReviewGroup;
  selected: ReadonlySet<number>;
  // Rows shown, and how many the next Show more adds (0 hides the button).
  count: number;
  more: number;
  changeError: CommandError | null;
  reviewError: CommandError | null;
  // Any review mutation is running; saving is this group's Looks good.
  busy: boolean;
  saving: boolean;
  onSelect: (ids: number[], on: boolean) => void;
  onSelectLike: (row: Transaction) => void;
  onChangeRow: (row: Transaction, categoryId: number | null) => void;
  onDismissChange: () => void;
  onDismissReview: () => void;
  onShowMore: () => void;
  onLooksGood: () => void;
};

// Review page mutation variables; groupId says which group shows the error.
export type ReviewChangeVariables = { groupId: number; row: Transaction; categoryId: number | null };
export type ReviewLooksGoodVariables = { groupId: number; transactionIds: number[] };
export type ReviewBulkVariables = { transactionIds: number[]; categoryId: number };

export type CategoryFormProps = {
  // The category being edited, or null to add one.
  editing: Category | null;
  // Called after a save, or on Cancel while editing.
  onDone: () => void;
  // A categorize run is going; `lockId` is the element that says so.
  locked: boolean;
  lockId: string;
};

export type CategoryRowProps = {
  category: Category;
  position: number;
  total: number;
  // Set while a run goes or a reorder saves; `lockId` is the run notice, when there is one.
  locked: boolean;
  lockId?: string;
  onEdit: (from: HTMLElement) => void;
  onDelete: (from: HTMLElement) => void;
};

export type CategoryDeleteDialogProps = {
  category: Category | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus: (event: Event) => void;
};

// Text size choices, in percent of the default root font size.
export type TextSize = 90 | 100 | 115 | 130 | 150;
