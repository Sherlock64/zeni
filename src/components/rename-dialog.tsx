import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { CategorySelect } from "@/components/category-select";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { NicknameRuleFields, RuleMatchCount } from "@/components/nickname-rule-fields";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listNicknames, saveNicknameRule, updateNickname } from "@/lib/commands";
import { focusFirstInvalid } from "@/lib/focus";
import { errorField } from "@/lib/nickname-errors";
import { NICKNAME_MAX_LEN } from "@/lib/nickname-limits";
import { invalidate, NICKNAMES_KEY } from "@/lib/query-keys";
import type { Nickname } from "@/types/bindings/Nickname";
import type { RuleInput } from "@/types/bindings/RuleInput";
import type { CommandError } from "@/types/command";
import type { RenameDialogProps } from "@/types/ui";

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// "What's its nickname?": names a transaction with a rule that starts as an exact match on its description.
// On a row that already has a nickname, keeping the rule and typing a name no other nickname has renames that
// nickname; typing another nickname's name, or changing the rule, adds the rule as on any other row.
export function RenameDialog({ transaction, open, onOpenChange, onCloseAutoFocus }: RenameDialogProps) {
  const queryClient = useQueryClient();
  const current = transaction.nickname;
  const [name, setName] = useState(current ?? "");
  const [initialRule] = useState<RuleInput>({ mode: "exact", field: "description", pattern: transaction.description.trim() });
  const [rule, setRule] = useState(initialRule);
  const [expanded, setExpanded] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const nicknames = useQuery({ queryKey: NICKNAMES_KEY, queryFn: listNicknames });
  // A refetch clears the query's error while it runs, so keep showing the last one until the retry settles.
  const [retriedError, setRetriedError] = useState<CommandError | null>(null);
  const listError = nicknames.error ?? retriedError;
  const nameInput = useRef<HTMLInputElement>(null);
  const ruleChanged = rule.mode !== initialRule.mode || rule.field !== initialRule.field || rule.pattern !== initialRule.pattern;
  const currentNickname = current ? nicknames.data?.find((nickname) => sameName(nickname.name, current)) : undefined;
  // Another nickname with the typed name: the rule is added to it.
  const existing = name.trim()
    ? nicknames.data?.find((nickname) => sameName(nickname.name, name) && !(current && sameName(nickname.name, current)))
    : undefined;
  const keepsRule = Boolean(current) && !ruleChanged;
  const renaming = keepsRule && !existing;
  // The nickname this save lands on, whose default category the picker starts from until the user picks one.
  const named = name.trim() ? nicknames.data?.find((nickname) => sameName(nickname.name, name)) : undefined;
  const target = named ?? (renaming ? currentNickname : undefined);
  const [picked, setPicked] = useState<{ id: number | null } | null>(null);
  const defaultCategoryId = picked ? picked.id : (target?.defaultCategoryId ?? null);
  const selectId = useId();
  const hintId = useId();
  // Whether a rename or an add is meant depends on the list, and so does the default to keep, so Save waits for
  // it unless the user picked a default themselves.
  const waitingForList = !nicknames.data && (keepsRule || !picked);
  const save = useMutation({
    mutationFn: (send: () => Promise<Nickname>) => send(),
    onSuccess: () => {
      invalidate(queryClient, "nickname");
      onOpenChange(false);
    },
    // The pattern field may be inside the closed expander.
    onError: (error) => errorField(error) === "pattern" && setExpanded(true),
  });
  const field = errorField(save.error);
  useEffect(() => {
    if (field) focusFirstInvalid(form.current);
  }, [save.error, field]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending || waitingForList) return;
    // The request omits a null default, which clears it.
    const sent = defaultCategoryId ?? undefined;
    if (!renaming) return save.mutate(() => saveNicknameRule({ name, rule, defaultCategoryId: sent }));
    if (current && sameName(name, current) && defaultCategoryId === (currentNickname?.defaultCategoryId ?? null)) {
      return onOpenChange(false);
    }
    // Never fall back to adding a rule here: that would leave the row showing the old nickname.
    if (!currentNickname) return save.mutate(() => Promise.reject({ kind: "NotFound", message: "That nickname no longer exists." }));
    const { id, enabled, staleExempt } = currentNickname;
    save.mutate(() => updateNickname({ id, name, enabled, staleExempt, defaultCategoryId: sent }));
  }

  async function retryList() {
    if (nicknames.isFetching || !nicknames.error) return;
    setRetriedError(nicknames.error);
    const result = await nicknames.refetch();
    setRetriedError(null);
    // The retry button unmounts on success.
    if (result.isSuccess) nameInput.current?.focus();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <form ref={form} onSubmit={submit} className="flex min-w-0 flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>What's its nickname?</DialogTitle>
            <DialogDescription className="break-words">
              Zeni shows the nickname instead of the bank's text on every transaction the rule matches.{" "}
              {renaming
                ? `This row is shown as “${current}”. A new name renames ${current} on every transaction its rules match. To name only transactions like this one, change the match options.`
                : `The rule starts as an exact match on “${transaction.description.trim()}”.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <TextField
              label="Nickname"
              name="nickname"
              ref={nameInput}
              aria-required="true"
              maxLength={NICKNAME_MAX_LEN}
              value={name}
              error={field === "name" ? save.error?.message : undefined}
              onChange={(event) => {
                save.reset();
                setName(event.target.value);
              }}
            />
            {/* Live regions stay mounted so their text changes are announced. */}
            <p aria-live="polite" className="text-sm text-muted-foreground empty:sr-only">
              {existing && `Adds this rule to ${existing.name}.`}
            </p>
          </div>
          <Collapsible open={expanded} onOpenChange={setExpanded} className="flex flex-col gap-4">
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="self-start">
                Match options
                <ChevronDownIcon aria-hidden="true" className={expanded ? "rotate-180" : ""} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <NicknameRuleFields
                value={rule}
                onChange={(next) => {
                  save.reset();
                  setRule(next);
                }}
                error={field === "pattern" ? save.error?.message : undefined}
              />
            </CollapsibleContent>
          </Collapsible>
          {/* The closed expander unmounts the fields and their count, so the prefilled rule's count shows here instead. */}
          {!expanded && <RuleMatchCount rule={rule} />}
          <div className="flex flex-col gap-2">
            <Label htmlFor={selectId}>Default category</Label>
            <CategorySelect
              id={selectId}
              aria-describedby={hintId}
              value={defaultCategoryId}
              onChange={(id) => {
                save.reset();
                setPicked({ id });
              }}
              uncategorizedLabel="No default"
            />
            <p id={hintId} className="text-sm text-muted-foreground">
              Rows this nickname matches get this category without asking the model.
            </p>
          </div>
          <p aria-live="polite" className="text-sm text-muted-foreground empty:sr-only">
            {current && !renaming && `This row is shown as “${current}”. Its rule may still win over this one.`}
          </p>
          {waitingForList && listError && (
            <div className="flex flex-col items-start gap-3">
              {/* A new key remounts the alert, so a repeat failure is announced again. */}
              <CommandErrorAlert
                key={nicknames.errorUpdatedAt}
                title="Couldn't load your nicknames"
                error={listError}
                nextStep={
                  keepsRule
                    ? "Zeni needs them to tell a rename from a new rule. Try again, or change the match options and pick a default category to add a rule."
                    : "Zeni needs them to keep the nickname's default category. Try again, or pick a default category."
                }
              />
              <Button type="button" variant="outline" onClick={retryList} aria-disabled={nicknames.isFetching}>
                {nicknames.isFetching ? "Trying again…" : "Try again"}
              </Button>
            </div>
          )}
          {save.error && !field && (
            <CommandErrorAlert
              title="Couldn't save the nickname"
              error={save.error}
              nextStep="Nothing was saved. Check the nickname and the match options, then save again."
            />
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => !save.isPending && onOpenChange(false)}
              aria-disabled={save.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" aria-disabled={save.isPending || waitingForList}>
              {save.isPending ? "Saving…" : "Save nickname"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
