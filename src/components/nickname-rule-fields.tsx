import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { TextField } from "@/components/text-field";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { countRuleMatches } from "@/lib/commands";
import { PATTERN_MAX_LEN } from "@/lib/nickname-limits";
import type { MatchField } from "@/types/bindings/MatchField";
import type { MatchMode } from "@/types/bindings/MatchMode";
import type { RuleInput } from "@/types/bindings/RuleInput";
import type { NicknameRuleFieldsProps, RuleMatchCountProps } from "@/types/ui";

const modes: [MatchMode, string, string][] = [
  ["exact", "Exact", "The whole text, ignoring case."],
  ["contains", "Contains", "Any part of the text, ignoring case."],
  ["regex", "Regex", "A regular expression, ignoring case."],
];
const fields: [MatchField, string][] = [
  ["description", "Description"],
  ["memo", "Memo"],
];

// The live count for a rule, refetched once typing pauses. Callers showing the same rule share the query.
function useRuleCount(value: RuleInput) {
  const [rule, setRule] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setRule(value), 300);
    return () => clearTimeout(timer);
  }, [value]);
  const blank = !rule.pattern.trim();
  const count = useQuery({
    queryKey: ["count_rule_matches", rule],
    queryFn: () => countRuleMatches(rule),
    enabled: !blank,
    placeholderData: keepPreviousData,
  });
  const regexError = count.error?.kind === "Validation" ? count.error.message : undefined;
  return { blank, count, regexError };
}

// "Matches N transactions" for a rule; hidden while the pattern is blank or invalid.
export function RuleMatchCount({ rule }: RuleMatchCountProps) {
  const { blank, count, regexError } = useRuleCount(rule);

  function countText() {
    if (blank || count.error) return "";
    if (count.data === undefined) return "Counting matches…";
    return `Matches ${count.data} ${count.data === 1 ? "transaction" : "transactions"}`;
  }

  return (
    <>
      {count.error && !regexError && <CommandErrorAlert title="Couldn't count matches" error={count.error} />}
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {countText()}
      </p>
    </>
  );
}

// Mode, field and pattern of one nickname rule, with a live count of the transactions it matches.
export function NicknameRuleFields({ value, onChange, error }: NicknameRuleFieldsProps) {
  const id = useId();
  const { regexError } = useRuleCount(value);
  const set = (change: Partial<typeof value>) => onChange({ ...value, ...change });

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm leading-none font-medium">Mode</legend>
        <RadioGroup
          value={value.mode}
          onValueChange={(mode) => set({ mode: mode as MatchMode })}
          className="flex flex-wrap gap-x-4 gap-y-2 pt-1"
        >
          {modes.map(([mode, label]) => (
            <div key={mode} className="flex items-center gap-2">
              <RadioGroupItem id={`${id}-${mode}`} value={mode} className="border-muted-foreground" />
              <Label htmlFor={`${id}-${mode}`} className="font-normal">
                {label}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm leading-none font-medium">Field</legend>
        <RadioGroup
          value={value.field}
          onValueChange={(field) => set({ field: field as MatchField })}
          className="flex flex-wrap gap-x-4 gap-y-2 pt-1"
        >
          {fields.map(([field, label]) => (
            <div key={field} className="flex items-center gap-2">
              <RadioGroupItem id={`${id}-${field}`} value={field} className="border-muted-foreground" />
              <Label htmlFor={`${id}-${field}`} className="font-normal">
                {label}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </fieldset>
      <TextField
        label="Pattern"
        name="pattern"
        aria-required="true"
        maxLength={PATTERN_MAX_LEN}
        value={value.pattern}
        hint={modes.find(([mode]) => mode === value.mode)?.[2]}
        error={error ?? regexError}
        announce
        onChange={(event) => set({ pattern: event.target.value })}
      />
      <RuleMatchCount rule={value} />
    </div>
  );
}
