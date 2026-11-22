import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EllipsisIcon, PlusIcon, TagIcon } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { CategorySelect } from "@/components/category-select";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { NicknameRuleFields } from "@/components/nickname-rule-fields";
import { Page } from "@/components/page";
import { TextField } from "@/components/text-field";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  deleteNickname,
  deleteNicknameRule,
  listNicknames,
  saveNicknameRule,
  updateNickname,
  updateNicknameRule,
} from "@/lib/commands";
import { formatDate } from "@/lib/dates";
import { focusFirstInvalid } from "@/lib/focus";
import { errorField } from "@/lib/nickname-errors";
import { NICKNAME_MAX_LEN } from "@/lib/nickname-limits";
import { invalidate, NICKNAMES_KEY } from "@/lib/query-keys";
import type { Nickname } from "@/types/bindings/Nickname";
import type { NicknameRule } from "@/types/bindings/NicknameRule";
import type { RuleInput } from "@/types/bindings/RuleInput";
import type { CommandError } from "@/types/command";
import type {
  NicknameDeleteTarget,
  NicknameDialogTarget,
  NicknameFormDialogProps,
  NicknameMenuItem,
  NicknameMatchesProps,
  NicknameRowMenuProps,
} from "@/types/ui";

const modeLabels = { exact: "Exact", contains: "Contains", regex: "Regex" } as const;
const fieldLabels = { description: "Description", memo: "Memo" } as const;

function useRefresh() {
  const queryClient = useQueryClient();
  return () => invalidate(queryClient, "nickname");
}

// The whole nickname goes back on every update, so a save never clears its default category by accident.
// The request omits a null default, which clears it.
const updateRequest = ({ id, name, enabled, staleExempt, defaultCategoryId }: Nickname) =>
  updateNickname({ id, name, enabled, staleExempt, defaultCategoryId: defaultCategoryId ?? undefined });

// Last matched date over the match count, so the table fits a narrow window.
function NicknameMatches({ count, last }: NicknameMatchesProps) {
  return (
    <span className="flex flex-col">
      <span>{last ? formatDate(last) : "Never matched"}</span>
      <span className="text-xs text-muted-foreground">
        {count} {count === 1 ? "match" : "matches"}
      </span>
    </span>
  );
}

// A row's actions in one menu. An item with `disabledReason` stays focusable and says why it can't be used.
function NicknameRowMenu({ label, items, menuFor }: NicknameRowMenuProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const reasonId = useId();
  return (
    // Not modal, so a dialog opened from an item takes focus cleanly.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button ref={trigger} variant="ghost" size="icon-sm" aria-label={label} data-nickname-menu={menuFor}>
          <EllipsisIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-64">
        {items.map((item, index) => (
          <DropdownMenuItem
            key={item.label}
            variant={item.destructive && !item.disabledReason ? "destructive" : "default"}
            aria-disabled={item.disabledReason ? true : undefined}
            aria-describedby={item.disabledReason ? `${reasonId}-${index}` : undefined}
            className={item.disabledReason ? "flex-col items-start gap-0.5 text-muted-foreground" : undefined}
            onSelect={(event) => {
              if (item.disabledReason) return event.preventDefault();
              if (trigger.current) item.onSelect(trigger.current);
            }}
          >
            {item.label}
            {/* Hidden from the item's name; aria-describedby still reads it as the description. */}
            {item.disabledReason && (
              <span id={`${reasonId}-${index}`} aria-hidden="true" className="text-xs">
                {item.disabledReason}
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function NicknamesPage() {
  const queryClient = useQueryClient();
  const refresh = useRefresh();
  const nicknames = useQuery({ queryKey: NICKNAMES_KEY, queryFn: listNicknames });
  // A refetch clears the query's error while it runs, so keep showing the last one until the retry settles.
  const [retriedError, setRetriedError] = useState<CommandError | null>(null);
  const listError = nicknames.error ?? retriedError;
  const [onlyStale, setOnlyStale] = useState(false);
  const table = useRef<HTMLDivElement>(null);
  const staleFilter = useRef<HTMLButtonElement>(null);
  const hintId = useId();
  // The button that opened a dialog; when a delete removed it, the nickname's menu or Add nickname.
  const opener = useRef<HTMLElement | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const [target, setTarget] = useState<NicknameDialogTarget>({ kind: "add" });
  const [formOpen, setFormOpen] = useState(false);
  // Remounts the form dialog on every open, so it starts from the target's values.
  const [formKey, setFormKey] = useState(0);
  const [deleting, setDeleting] = useState<NicknameDeleteTarget | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Switches and checkboxes change at once and go back if the save fails.
  const toggle = useMutation({
    mutationFn: updateRequest,
    onMutate: async (request) => {
      await queryClient.cancelQueries({ queryKey: NICKNAMES_KEY });
      const previous = queryClient.getQueryData<Nickname[]>(NICKNAMES_KEY);
      queryClient.setQueryData<Nickname[]>(NICKNAMES_KEY, (list) =>
        list?.map((nickname) => (nickname.id === request.id ? { ...nickname, ...request } : nickname)),
      );
      return previous;
    },
    onError: (_error, _request, previous) => queryClient.setQueryData(NICKNAMES_KEY, previous),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: ({ nickname, rule }: NicknameDeleteTarget) =>
      rule ? deleteNicknameRule({ id: rule.id }) : deleteNickname({ id: nickname.id }),
    // Close once the list shows the change, so focus can go to a control that still exists.
    onSuccess: async () => {
      await refresh();
      setDeleteOpen(false);
    },
  });

  function setFlag(nickname: Nickname, change: Partial<Pick<Nickname, "enabled" | "staleExempt" | "defaultCategoryId">>) {
    if (toggle.isPending) return;
    toggle.mutate({ ...nickname, ...change });
  }

  function openForm(next: NicknameDialogTarget, from: HTMLElement) {
    opener.current = from;
    setTarget(next);
    setFormKey((key) => key + 1);
    setFormOpen(true);
  }

  function startDelete(next: NicknameDeleteTarget, from: HTMLElement) {
    opener.current = from;
    remove.reset();
    setDeleting(next);
    setDeleteOpen(true);
  }

  function returnFocus(event: Event) {
    event.preventDefault();
    if (opener.current?.isConnected) return opener.current.focus();
    const menu = deleting?.rule && table.current?.querySelector<HTMLElement>(`[data-nickname-menu="${deleting.nickname.id}"]`);
    (menu || addButton.current)?.focus();
  }

  function ruleItems(nickname: Nickname, rule: NicknameRule): NicknameMenuItem[] {
    return [
      { label: "Edit rule", onSelect: (from) => openForm({ kind: "editRule", nickname, rule }, from) },
      {
        label: "Delete rule",
        destructive: true,
        disabledReason:
          nickname.rules.length === 1 ? "A nickname needs at least one rule. Delete the nickname instead." : undefined,
        onSelect: (from) => startDelete({ nickname, rule }, from),
      },
    ];
  }

  async function retry() {
    if (nicknames.isFetching || !nicknames.error) return;
    setRetriedError(nicknames.error);
    const result = await nicknames.refetch();
    setRetriedError(null);
    // The retry button unmounts on success, so move focus to the page heading.
    if (result.isSuccess) document.querySelector<HTMLElement>("main h1")?.focus();
  }

  function status() {
    if (listError) return nicknames.isFetching ? "Retrying…" : "";
    if (nicknames.isPending) return "Loading nicknames…";
    if (onlyStale && nicknames.data) {
      const count = nicknames.data.filter((nickname) => nickname.stale).length;
      return `${count} stale ${count === 1 ? "nickname" : "nicknames"} shown.`;
    }
    return "";
  }

  const addNickname = (
    <Button ref={addButton} onClick={(event) => openForm({ kind: "add" }, event.currentTarget)}>
      <PlusIcon aria-hidden="true" />
      Add nickname
    </Button>
  );

  function content() {
    if (listError) {
      return (
        <div className="flex flex-col items-start gap-3">
          {/* A new key remounts the alert, so a repeat failure is announced again. */}
          <CommandErrorAlert key={nicknames.errorUpdatedAt} title="Couldn't load nicknames" error={listError} />
          <Button variant="outline" onClick={retry} aria-disabled={nicknames.isFetching}>
            {nicknames.isFetching ? "Trying again…" : "Try again"}
          </Button>
        </div>
      );
    }
    if (!nicknames.data) {
      return (
        <div aria-hidden="true" className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      );
    }
    if (nicknames.data.length === 0) {
      return (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TagIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>
              <h2>No nicknames yet.</h2>
            </EmptyTitle>
            <EmptyDescription>Right-click a transaction and choose Rename it, or add one here.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{addNickname}</EmptyContent>
        </Empty>
      );
    }
    const shown = onlyStale ? nicknames.data.filter((nickname) => nickname.stale) : nicknames.data;
    return (
      <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            ref={staleFilter}
            variant={onlyStale ? "secondary" : "outline"} aria-pressed={onlyStale} onClick={() => setOnlyStale(!onlyStale)}>
            Show only stale
          </Button>
          {addNickname}
        </div>
        {shown.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>
                <h2>No stale nicknames.</h2>
              </EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button
                variant="outline"
                onClick={() => {
                  setOnlyStale(false);
                  // This button goes away with the filter, so focus the filter's toggle.
                  staleFilter.current?.focus();
                }}
              >
                Show all nicknames
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <>
            <p id={hintId} className="text-sm text-muted-foreground">
              Default category: rows this nickname matches get this category without asking the model.
            </p>
            <div ref={table} className="rounded-xl border" aria-busy={nicknames.isFetching}>
              {/* Fixed column widths, so the columns don't shift when the filter changes the rows. */}
              {/* A minimum width keeps the name column readable; a narrow window scrolls the table sideways. */}
              <Table aria-label="Nicknames" className="min-w-[42rem] table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Nickname and rules</TableHead>
                    <TableHead scope="col" className="w-32">
                      Last matched
                    </TableHead>
                    <TableHead scope="col" className="w-14">
                      On
                    </TableHead>
                    <TableHead scope="col" className="w-24 whitespace-normal">
                      Don't flag as stale
                    </TableHead>
                    <TableHead scope="col" className="w-40">
                      Default category
                    </TableHead>
                    <TableHead scope="col" className="w-11">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                {shown.map((nickname) => (
                  <TableBody key={nickname.id} className="border-b last:border-b-0 [&_tr]:border-b-0">
                    <TableRow>
                      <TableCell className={nickname.enabled ? "whitespace-normal" : "whitespace-normal text-muted-foreground"}>
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-medium wrap-anywhere">{nickname.name}</span>
                          {nickname.stale && <Badge variant="secondary">Stale</Badge>}
                        </span>
                      </TableCell>
                      <TableCell>
                        <NicknameMatches count={nickname.matchCount} last={nickname.lastMatched} />
                      </TableCell>
                      <TableCell>
                        <Switch
                          aria-label={`${nickname.name} on`}
                          checked={nickname.enabled}
                          aria-disabled={toggle.isPending}
                          onCheckedChange={(enabled) => setFlag(nickname, { enabled })}
                        />
                      </TableCell>
                      <TableCell>
                        <Checkbox
                          aria-label={`Don't flag ${nickname.name} as stale`}
                          className="border-muted-foreground"
                          checked={nickname.staleExempt}
                          aria-disabled={toggle.isPending}
                          onCheckedChange={(checked) => setFlag(nickname, { staleExempt: checked === true })}
                        />
                      </TableCell>
                      <TableCell>
                        <CategorySelect
                          aria-label={`${nickname.name} default category`}
                          aria-describedby={hintId}
                          aria-disabled={toggle.isPending}
                          value={nickname.defaultCategoryId}
                          onChange={(defaultCategoryId) => setFlag(nickname, { defaultCategoryId })}
                          uncategorizedLabel="No default"
                        />
                      </TableCell>
                      <TableCell>
                        <NicknameRowMenu
                          label={`Actions for ${nickname.name}`}
                          menuFor={nickname.id}
                          items={[
                            { label: "Rename", onSelect: (from) => openForm({ kind: "rename", nickname }, from) },
                            { label: "Add rule", onSelect: (from) => openForm({ kind: "addRule", nickname }, from) },
                            // With one rule, its actions live here, so the nickname has one menu.
                            ...(nickname.rules.length === 1 ? ruleItems(nickname, nickname.rules[0]) : []),
                            { label: "Delete nickname", destructive: true, onSelect: (from) => startDelete({ nickname }, from) },
                          ]}
                        />
                      </TableCell>
                    </TableRow>
                    {nickname.rules.map((rule) => (
                      <TableRow key={rule.id}>
                        <TableCell className="pl-6 whitespace-normal">
                          <span className="block whitespace-nowrap text-muted-foreground">
                            {modeLabels[rule.mode]} · {fieldLabels[rule.field]}
                          </span>
                          <code className="font-mono text-xs wrap-anywhere">{rule.pattern}</code>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {/* With one rule its figures are the nickname's, shown on the row above. */}
                          {nickname.rules.length > 1 && <NicknameMatches count={rule.matchCount} last={rule.lastMatched} />}
                        </TableCell>
                        <TableCell />
                        <TableCell />
                        <TableCell />
                        <TableCell>
                          {nickname.rules.length > 1 && (
                            <NicknameRowMenu label={`Actions for rule ${rule.pattern}`} items={ruleItems(nickname, rule)} />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                ))}
              </Table>
            </div>
          </>
        )}
      </>
    );
  }

  const rule = deleting?.rule;
  return (
    <Page
      title="Nicknames"
      description="Names Zeni shows instead of the bank's text on the transactions each rule matches."
    >
      {/* Always mounted, so screen readers announce each change to its text. */}
      <p role="status" className="sr-only">
        {status()}
      </p>
      {toggle.isError && (
        <CommandErrorAlert
          title={`Couldn't change ${toggle.variables.name}`}
          error={toggle.error}
          nextStep="The change was undone. Try again."
          onDismiss={toggle.reset}
        />
      )}
      {content()}

      <NicknameFormDialog
        key={formKey}
        target={target}
        open={formOpen}
        onOpenChange={setFormOpen}
        onCloseAutoFocus={returnFocus}
      />

      <AlertDialog open={deleteOpen} onOpenChange={(next) => !remove.isPending && setDeleteOpen(next)}>
        <AlertDialogContent onCloseAutoFocus={returnFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words">
              {rule ? `Delete this rule from ${deleting?.nickname.name}?` : `Delete ${deleting?.nickname.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription className="wrap-anywhere">
              {rule
                ? `Zeni stops matching “${rule.pattern}” (${modeLabels[rule.mode]} · ${fieldLabels[rule.field]}). Transactions it matched show the bank's text again, unless another rule matches them.`
                : "Its rules are deleted and its transactions show the bank's text again."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {remove.isError && (
            <CommandErrorAlert title={rule ? "Couldn't delete the rule" : "Couldn't delete the nickname"} error={remove.error} />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel aria-disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => deleting && !remove.isPending && remove.mutate(deleting)}
              aria-disabled={remove.isPending}
            >
              {remove.isPending ? "Deleting…" : rule ? "Delete rule" : "Delete nickname"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

const blankRule: RuleInput = { mode: "exact", field: "description", pattern: "" };

// Add nickname, Rename, Add rule and Edit rule: a name field, rule fields or both.
function NicknameFormDialog({ target, open, onOpenChange, onCloseAutoFocus }: NicknameFormDialogProps) {
  const refresh = useRefresh();
  const nickname = target.kind === "add" ? null : target.nickname;
  const [name, setName] = useState(nickname?.name ?? "");
  const [rule, setRule] = useState<RuleInput>(
    target.kind === "editRule" ? { mode: target.rule.mode, field: target.rule.field, pattern: target.rule.pattern } : blankRule,
  );
  const form = useRef<HTMLFormElement>(null);
  const nicknames = useQuery({ queryKey: NICKNAMES_KEY, queryFn: listNicknames, enabled: open && target.kind === "add" });
  const save = useMutation({
    mutationFn: async () => {
      // A rule added to an existing nickname keeps its default category; the request omits a null one, which clears it.
      if (target.kind === "add") return saveNicknameRule({ name, rule, defaultCategoryId: existing?.defaultCategoryId ?? undefined });
      if (target.kind === "addRule") {
        return saveNicknameRule({ name: target.nickname.name, rule, defaultCategoryId: target.nickname.defaultCategoryId ?? undefined });
      }
      if (target.kind === "editRule") return updateNicknameRule({ id: target.rule.id, rule });
      return updateRequest({ ...target.nickname, name });
    },
    // Close once the list shows the change, so focus can go back to a button that still exists.
    onSuccess: async () => {
      await refresh();
      onOpenChange(false);
    },
  });
  const field = errorField(save.error);
  useEffect(() => {
    if (field) focusFirstInvalid(form.current);
  }, [save.error, field]);

  const showName = target.kind === "add" || target.kind === "rename";
  const showRule = target.kind !== "rename";
  const typed = name.trim().toLowerCase();
  const existing =
    target.kind === "add" && typed ? nicknames.data?.find((other) => other.name.toLowerCase() === typed) : undefined;
  const text = {
    add: ["Add nickname", "Zeni shows the nickname instead of the bank's text on every transaction the rule matches.", "Save nickname"],
    rename: [`Rename ${nickname?.name}`, "The new name shows on every transaction its rules match.", "Save name"],
    addRule: [`Add a rule to ${nickname?.name}`, "Transactions this rule matches show this nickname too.", "Save rule"],
    editRule: [`Edit a rule of ${nickname?.name}`, "Every transaction the changed rule matches, past and future, shows this nickname.", "Save rule"],
  }[target.kind];

  function submit(event: FormEvent) {
    event.preventDefault();
    // Adding to an existing name keeps its default, so wait for the list that holds it.
    if (!save.isPending && !(target.kind === "add" && !nicknames.data)) save.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent className="flex max-h-[calc(100%-2rem)] flex-col" onCloseAutoFocus={onCloseAutoFocus}>
        <form ref={form} onSubmit={submit} className="flex min-h-0 min-w-0 flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle className="break-words">{text[0]}</DialogTitle>
            <DialogDescription>{text[1]}</DialogDescription>
          </DialogHeader>
          <div className="-mx-4 flex min-h-0 flex-col gap-4 overflow-y-auto px-4 py-1">
            {showName && (
              <div className="flex flex-col gap-2">
                <TextField
                  label="Nickname"
                  name="nickname"
                  aria-required="true"
                  maxLength={NICKNAME_MAX_LEN}
                  value={name}
                  error={field === "name" ? save.error?.message : undefined}
                  onChange={(event) => {
                    save.reset();
                    setName(event.target.value);
                  }}
                />
                {/* Always mounted, so screen readers announce the merge when it appears. */}
                <p aria-live="polite" className="text-sm text-muted-foreground empty:sr-only">
                  {existing && `Adds this rule to ${existing.name}.`}
                </p>
              </div>
            )}
            {showRule && (
              <NicknameRuleFields
                value={rule}
                onChange={(next) => {
                  save.reset();
                  setRule(next);
                }}
                error={field === "pattern" ? save.error?.message : undefined}
              />
            )}
            {save.error && !field && (
              <CommandErrorAlert
                title="Couldn't save"
                error={save.error}
                nextStep="Nothing was saved. Check your entries, then save again."
              />
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => !save.isPending && onOpenChange(false)} aria-disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" aria-disabled={save.isPending}>
              {save.isPending ? "Saving…" : text[2]}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
