import type { ComponentProps, ReactNode } from "react";
import type { Account } from "@/types/bindings/Account";
import type { ImportRecord } from "@/types/bindings/ImportRecord";
import type { ImportSummary } from "@/types/bindings/ImportSummary";
import type { LockReason } from "@/types/bindings/LockReason";
import type { TransactionQuery } from "@/types/bindings/TransactionQuery";
import type { TransactionSort } from "@/types/bindings/TransactionSort";
import type { CommandError } from "@/types/command";

export type PageProps = { title: string; description: string; children: ReactNode };

export type CommandErrorAlertProps = { title: string; error: CommandError; onDismiss?: () => void };

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

export type UnlockPageProps = { reason: LockReason };

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
