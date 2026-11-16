import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { NicknameRuleFields, RuleMatchCount } from "@/components/nickname-rule-fields";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listNicknames, saveNicknameRule, updateNickname } from "@/lib/commands";
import { focusFirstInvalid } from "@/lib/focus";
import type { Nickname } from "@/types/bindings/Nickname";
import type { RuleInput } from "@/types/bindings/RuleInput";
import type { CommandError } from "@/types/command";
import type { RenameDialogProps } from "@/types/ui";

// Which field a save_nickname_rule or update_nickname Validation message belongs to, by the backend's wording.
function errorField(error: CommandError | null) {
  if (error?.kind !== "Validation") return null;
  if (/^(Enter a nickname|Nicknames can be|A nickname named)/.test(error.message)) return "name";
  if (/^(Enter a pattern|Patterns can be|That regex isn't valid)/.test(error.message)) return "pattern";
  return null;
}

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
  const nicknames = useQuery({ queryKey: ["list_nicknames"], queryFn: listNicknames });
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
  // Whether a rename or an add is meant depends on the list, so Save waits for it.
  const waitingForList = keepsRule && !nicknames.data;
  const save = useMutation({
    mutationFn: (send: () => Promise<Nickname>) => send(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["list_transactions"] });
      queryClient.invalidateQueries({ queryKey: ["list_nicknames"] });
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
    if (!renaming) return save.mutate(() => saveNicknameRule({ name, rule }));
    if (current && sameName(name, current)) return onOpenChange(false);
    // Never fall back to adding a rule here: that would leave the row showing the old nickname.
    if (!currentNickname) return save.mutate(() => Promise.reject({ kind: "NotFound", message: "That nickname no longer exists." }));
    const { id, enabled, staleExempt } = currentNickname;
    save.mutate(() => updateNickname({ id, name, enabled, staleExempt }));
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
              Zeni shows the nickname instead of the bank's description on every transaction the rule matches.{" "}
              {renaming
                ? `This row is shown as “${current}”. A new name renames ${current} on every transaction its rules match. To name only transactions like this one, change the match options.`
                : `The rule starts as an exact match on “${transaction.description.trim()}”.`}
              {current && !renaming && ` This row is currently shown as “${current}”.`}
            </DialogDescription>
          </DialogHeader>
          <TextField
            label="Nickname"
            name="nickname"
            ref={nameInput}
            aria-required="true"
            maxLength={100}
            value={name}
            error={field === "name" ? save.error?.message : undefined}
            onChange={(event) => {
              save.reset();
              setName(event.target.value);
            }}
          />
          {/* Live regions stay mounted so their text changes are announced. */}
          <p aria-live="polite" className="-mt-2 text-sm text-muted-foreground empty:sr-only">
            {existing && `Adds this rule to ${existing.name}.`}
          </p>
          <Collapsible open={expanded} onOpenChange={setExpanded} className="flex flex-col gap-4">
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="-mx-2.5 self-start">
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
                showCount={false}
              />
            </CollapsibleContent>
          </Collapsible>
          {/* Outside the expander, so the prefilled rule's count shows while it is collapsed. */}
          <RuleMatchCount rule={rule} />
          <p aria-live="polite" className="text-sm text-muted-foreground empty:sr-only">
            {current && !renaming && `This row is shown as “${current}”. Its rule may still win over this one.`}
          </p>
          {keepsRule && listError && (
            <div className="flex flex-col items-start gap-3">
              {/* A new key remounts the alert, so a repeat failure is announced again. */}
              <CommandErrorAlert
                key={nicknames.errorUpdatedAt}
                title="Couldn't load your nicknames"
                error={listError}
                nextStep="Zeni needs them to tell a rename from a new rule. Try again, or change the match options to add a rule."
              />
              <Button type="button" variant="outline" onClick={retryList} aria-disabled={nicknames.isFetching}>
                Try again
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
