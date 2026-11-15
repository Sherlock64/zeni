import { useId } from "react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CsvMapping } from "@/types/bindings/CsvMapping";
import type { DateFormat } from "@/types/bindings/DateFormat";
import type { CsvMappingColumn, CsvMappingDraft, CsvMappingFormProps } from "@/types/ui";

const dateFormats: DateFormat[] = ["MM/DD/YYYY", "M/D/YYYY", "YYYY-MM-DD", "DD/MM/YYYY"];
const optional: [CsvMappingColumn, string][] = [
  ["transactionId", "Transaction ID"],
  ["memo", "Memo"],
  ["transactionType", "Transaction type"],
  ["runningBalance", "Running balance"],
  ["postingStatus", "Posting status"],
  ["bankCategory", "Bank category"],
];
// Radix Select can't use "" as an item value.
const NOT_MAPPED = "none";

// Header names (normalised like the backend: trimmed, single spaces, lowercase) that obviously hold a column.
// Earlier names win a role: the bank layout's Extended Description is the memo, not its Memo column (PRD).
const roleByHeader: Record<string, CsvMappingColumn> = {
  "posting date": "postedDate",
  "posted date": "postedDate",
  "transaction date": "postedDate",
  date: "postedDate",
  description: "description",
  amount: "amount",
  debit: "debit",
  credit: "credit",
  "transaction id": "transactionId",
  "extended description": "memo",
  memo: "memo",
  "transaction type": "transactionType",
  type: "transactionType",
  balance: "runningBalance",
  "running balance": "runningBalance",
  "posting status": "postingStatus",
  status: "postingStatus",
  "transaction category": "bankCategory",
  category: "bankCategory",
};

export function guessDraft(headers: string[]): CsvMappingDraft {
  const draft: CsvMappingDraft = {
    dateFormat: "MM/DD/YYYY",
    postedDate: null,
    description: null,
    amountKind: "signed",
    amount: null,
    debit: null,
    credit: null,
    transactionId: null,
    memo: null,
    transactionType: null,
    runningBalance: null,
    postingStatus: null,
    bankCategory: null,
  };
  const normalised = headers.map((header) => header.trim().replace(/\s+/g, " ").toLowerCase());
  for (const [name, role] of Object.entries(roleByHeader)) {
    const index = normalised.indexOf(name);
    if (index >= 0 && draft[role] === null) draft[role] = index;
  }
  if (draft.amount === null && draft.debit !== null && draft.credit !== null) draft.amountKind = "split";
  return draft;
}

export function draftFromMapping({ amount, ...mapping }: CsvMapping): CsvMappingDraft {
  return amount.kind === "signed"
    ? { ...mapping, amountKind: "signed", amount: amount.column, debit: null, credit: null }
    : { ...mapping, amountKind: "split", amount: null, debit: amount.debit, credit: amount.credit };
}

export function mappingFromDraft({ amountKind, amount, debit, credit, postedDate, description, ...rest }: CsvMappingDraft): CsvMapping | null {
  if (postedDate === null || description === null) return null;
  if (amountKind === "signed") return amount === null ? null : { ...rest, postedDate, description, amount: { kind: "signed", column: amount } };
  return debit === null || credit === null ? null : { ...rest, postedDate, description, amount: { kind: "split", debit, credit } };
}

export function CsvMappingForm({ headers, value, onChange, showRequired }: CsvMappingFormProps) {
  const id = useId();
  const set = (patch: Partial<CsvMappingDraft>) => {
    const next = { ...value, ...patch };
    onChange(next, mappingFromDraft(next));
  };

  function columnField(column: CsvMappingColumn, label: string, required: boolean) {
    const fieldId = `${id}-${column}`;
    const current = value[column];
    const invalid = required && showRequired && current === null;
    return (
      <div key={column} className="flex flex-col gap-2">
        <Label htmlFor={fieldId}>{label}</Label>
        <Select
          value={current === null ? (required ? "" : NOT_MAPPED) : String(current)}
          onValueChange={(next) => set({ [column]: next === NOT_MAPPED ? null : Number(next) })}
        >
          <SelectTrigger
            id={fieldId}
            className="w-full"
            aria-required={required || undefined}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${fieldId}-error` : undefined}
          >
            <SelectValue placeholder="Choose a column" />
          </SelectTrigger>
          <SelectContent position="popper">
            {!required && <SelectItem value={NOT_MAPPED}>Not mapped</SelectItem>}
            {headers.map((header, index) => (
              <SelectItem key={index} value={String(index)}>
                {header || `Column ${index + 1}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {invalid && (
          <p id={`${fieldId}-error`} className="text-sm text-destructive">
            Choose a column.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {columnField("postedDate", "Posted date", true)}
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-dateFormat`}>Date format</Label>
        <Select value={value.dateFormat} onValueChange={(next) => set({ dateFormat: next as DateFormat })}>
          <SelectTrigger id={`${id}-dateFormat`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {dateFormats.map((format) => (
              <SelectItem key={format} value={format}>
                {format}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {columnField("description", "Description", true)}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm leading-none font-medium">Amount</legend>
        <RadioGroup
          value={value.amountKind}
          onValueChange={(next) => set({ amountKind: next as CsvMappingDraft["amountKind"] })}
          className="flex flex-wrap gap-x-4 gap-y-2 pt-1"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem id={`${id}-signed`} value="signed" className="border-muted-foreground" />
            <Label htmlFor={`${id}-signed`} className="font-normal">
              One signed column
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem id={`${id}-split`} value="split" className="border-muted-foreground" />
            <Label htmlFor={`${id}-split`} className="font-normal">
              Debit and credit columns
            </Label>
          </div>
        </RadioGroup>
      </fieldset>
      {value.amountKind === "signed" ? (
        columnField("amount", "Amount column", true)
      ) : (
        <>
          {columnField("debit", "Debit column", true)}
          {columnField("credit", "Credit column", true)}
        </>
      )}
      {optional.map(([column, label]) => columnField(column, label, false))}
    </div>
  );
}
