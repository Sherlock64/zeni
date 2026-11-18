import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { addCategory, updateCategory } from "@/lib/commands";
import { focusFirstInvalid } from "@/lib/focus";
import { CATEGORIES_KEY } from "@/lib/query-keys";
import type { CategoryKind } from "@/types/bindings/CategoryKind";
import type { CommandError } from "@/types/command";
import type { CategoryFormProps } from "@/types/ui";

const NAME_MAX = 40;
const DESCRIPTION_MAX = 200;

export const kindLabels: Record<CategoryKind, string> = { spending: "Spending", income: "Income", transfer: "Transfer" };

// Which field a Validation message belongs to, by the wording of src-tauri/src/categories.rs.
export function categoryErrorField(error: CommandError | null) {
  if (error?.kind !== "Validation") return null;
  if (/^(Enter a category name|A category named)/.test(error.message) || error.message === `Use at most ${NAME_MAX} characters.`)
    return "name";
  if (error.message === `Use at most ${DESCRIPTION_MAX} characters.`) return "description";
  return null;
}

// Add a category, or edit the one passed in.
export function CategoryForm({ editing, onDone, locked, lockId }: CategoryFormProps) {
  const queryClient = useQueryClient();
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [kind, setKind] = useState<CategoryKind>(editing?.kind ?? "spending");
  const [saved, setSaved] = useState(false);
  // A new `editing` loads its values; going back to adding (after a save or Cancel) clears them and keeps "Saved.".
  const [shown, setShown] = useState(editing);
  if (editing !== shown) {
    setShown(editing);
    setName(editing?.name ?? "");
    setDescription(editing?.description ?? "");
    setKind(editing?.kind ?? "spending");
    if (editing) setSaved(false);
  }
  const save = useMutation({
    mutationFn: () =>
      editing ? updateCategory({ id: editing.id, name, description, kind }) : addCategory({ name, description, kind }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY });
      setName("");
      setDescription("");
      setKind("spending");
      setSaved(true);
      onDone();
    },
  });
  const { reset } = save;
  useEffect(() => {
    reset();
    // The form sits above the list, so move focus to it when editing starts.
    if (editing) form.current?.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
  }, [editing, reset]);
  const field = categoryErrorField(save.error);
  useEffect(() => {
    if (field) focusFirstInvalid(form.current);
  }, [save.error, field]);

  function change() {
    save.reset();
    setSaved(false);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!save.isPending && !locked) save.mutate();
  }

  const busy = save.isPending || locked;
  return (
    <Card className="w-full max-w-3xl">
      <CardHeader>
        <CardTitle>
          <h2 className="break-words">{editing ? `Edit ${editing.name}` : "Add a category"}</h2>
        </CardTitle>
        <CardDescription>The model picks from these names and descriptions.</CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={form} onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <TextField
            label="Name"
            name="name"
            aria-required="true"
            maxLength={NAME_MAX}
            value={name}
            readOnly={locked}
            error={field === "name" ? save.error?.message : undefined}
            onChange={(event) => {
              change();
              setName(event.target.value);
            }}
          />
          <TextField
            label="Description"
            name="description"
            maxLength={DESCRIPTION_MAX}
            value={description}
            readOnly={locked}
            hint="A clear description helps the model pick this category."
            error={field === "description" ? save.error?.message : undefined}
            onChange={(event) => {
              change();
              setDescription(event.target.value);
            }}
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm leading-none font-medium">Kind</legend>
            <RadioGroup
              value={kind}
              disabled={locked}
              onValueChange={(next) => {
                change();
                setKind(next as CategoryKind);
              }}
              className="flex flex-wrap gap-x-4 gap-y-2 pt-1"
            >
              {Object.entries(kindLabels).map(([value, label]) => (
                <div key={value} className="flex items-center gap-2">
                  <RadioGroupItem id={`${id}-${value}`} value={value} className="border-muted-foreground" />
                  <Label htmlFor={`${id}-${value}`} className="font-normal">
                    {label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>
          {save.error && !field && (
            <CommandErrorAlert
              title="Couldn't save the category"
              error={save.error}
              nextStep={save.error.kind === "Validation" ? "Nothing was saved. Check your entries, then save again." : undefined}
            />
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" aria-disabled={busy} aria-describedby={locked ? lockId : undefined}>
              {save.isPending ? "Saving…" : editing ? "Save category" : "Add category"}
            </Button>
            {editing && (
              <Button type="button" variant="outline" aria-disabled={save.isPending} onClick={() => !save.isPending && onDone()}>
                Cancel
              </Button>
            )}
            {/* Always mounted, so screen readers announce it. */}
            <p role="status" className="text-sm text-muted-foreground">
              {saved && "Saved."}
            </p>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
