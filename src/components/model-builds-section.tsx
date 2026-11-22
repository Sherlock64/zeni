import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BoxesIcon } from "lucide-react";
import { type FormEvent, type MouseEvent, useEffect, useId, useRef, useState } from "react";
import { CommandErrorAlert } from "@/components/command-error-alert";
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
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useJobStatus } from "@/hooks/use-job-status";
import {
  activateBuild,
  buildPreview,
  deleteBuild,
  listBuilds,
  ollamaSettings,
  ollamaStatus,
  setAllowOverWindow,
  setExamplesPerCategory,
  startBuild,
} from "@/lib/commands";
import { runningJobLabel } from "@/lib/job-label";
import { formatDate } from "@/lib/dates";
import { BUILD_PREVIEW_KEY, BUILDS_KEY, invalidate, JOB_STATUS_KEY, OLLAMA_SETTINGS_KEY, OLLAMA_STATUS_KEY } from "@/lib/query-keys";
import type { BuildPreview } from "@/types/bindings/BuildPreview";
import type { ModelBuild } from "@/types/bindings/ModelBuild";
import type { OllamaSettings } from "@/types/bindings/OllamaSettings";
import type { CommandError } from "@/types/command";


function previewText({ windowTokens, fit, total }: BuildPreview, allowOverWindow: boolean) {
  const windowText = `Ollama's ${windowTokens.toLocaleString("en-US")}-token window`;
  if (fit >= total) return `All ${total} examples fit ${windowText}.`;
  if (allowOverWindow)
    return `The next build uses all ${total} examples, past ${windowText}. Categorizing may stall unless Ollama's context is larger.`;
  return `The next build uses ${fit} of ${total} examples to fit ${windowText}.`;
}

export function ModelBuildsSection() {
  const queryClient = useQueryClient();
  const builds = useQuery({ queryKey: BUILDS_KEY, queryFn: listBuilds });
  const settings = useQuery({ queryKey: OLLAMA_SETTINGS_KEY, queryFn: ollamaSettings });
  const status = useQuery({ queryKey: OLLAMA_STATUS_KEY, queryFn: ollamaStatus });
  const job = useJobStatus();
  const baseModel = settings.data?.baseModel;
  // The base model is in the key so picking another one rechecks its window.
  const preview = useQuery({ queryKey: [...BUILD_PREVIEW_KEY, baseModel], queryFn: buildPreview, enabled: Boolean(baseModel) });
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const [toDelete, setToDelete] = useState<ModelBuild | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [examples, setExamples] = useState<string | null>(null);
  const [examplesRangeError, setExamplesRangeError] = useState(false);
  // Show a build's outcome only when this section saw it run, so an old one doesn't linger.
  const [sawBuild, setSawBuild] = useState(false);
  // A refetch from an error with no data goes back to pending, so keep the error up while trying again.
  const [retriedError, setRetriedError] = useState<CommandError | null>(null);

  // A build or a delete changes the models Ollama has installed.
  const refreshBuilds = () => invalidate(queryClient, "ollama");
  const start = useMutation({
    mutationFn: startBuild,
    onSuccess: (started) => queryClient.setQueryData(JOB_STATUS_KEY, started),
  });
  const activate = useMutation({
    mutationFn: activateBuild,
    onSuccess: async () => {
      await invalidate(queryClient, "ollama");
      // The pressed "Make active" button unmounts once its build is active, so don't leave focus on nothing.
      heading.current?.focus();
    },
  });
  const remove = useMutation({
    mutationFn: deleteBuild,
    onSuccess: () => {
      refreshBuilds();
      setDeleteOpen(false);
    },
  });
  // Both settings change what the next build uses, so recheck the preview.
  const savedSettings = (saved: OllamaSettings) => {
    queryClient.setQueryData(OLLAMA_SETTINGS_KEY, saved);
    invalidate(queryClient, "ollama");
  };
  const saveExamples = useMutation({
    mutationFn: setExamplesPerCategory,
    onSuccess: savedSettings,
  });
  const overWindow = useMutation({
    mutationFn: setAllowOverWindow,
    onSuccess: savedSettings,
  });

  const running = job.data?.running ?? null;
  const building = running?.kind === "build" ? running : null;
  const outcome = sawBuild && !running && job.data?.last?.kind === "build" ? job.data.last : null;

  const wasBuilding = useRef(false);
  useEffect(() => {
    if (building) {
      wasBuilding.current = true;
      setSawBuild(true);
    } else if (wasBuilding.current) {
      wasBuilding.current = false;
      invalidate(queryClient, "ollama");
    }
  }, [building, queryClient]);

  const reason =
    status.data && !status.data.reachable
      ? "Start Ollama to build a model."
      : settings.data && !settings.data.baseModel
        ? "Pick a base model to build."
        : running && !building
          ? runningJobLabel(running)
          : null;
  const buildBlocked = Boolean(reason) || Boolean(building) || start.isPending || !status.data || !settings.data;
  const active = builds.data?.find((build) => build.active);
  const rebuild = Boolean(active?.outOfDate);

  function build() {
    if (buildBlocked) return;
    start.reset();
    start.mutate();
  }

  function askDelete(target: ModelBuild, event: MouseEvent<HTMLButtonElement>) {
    if (remove.isPending) return;
    opener.current = event.currentTarget;
    remove.reset();
    setToDelete(target);
    setDeleteOpen(true);
  }

  const examplesValue = examples ?? String(settings.data?.examplesPerCategory ?? "");
  const examplesError = examplesRangeError
    ? "Enter a number from 1 to 20."
    : saveExamples.error?.kind === "Validation"
      ? saveExamples.error.message
      : undefined;

  function submitExamples(event: FormEvent) {
    event.preventDefault();
    if (saveExamples.isPending) return;
    // Mirrors the backend's range.
    const value = Number(examplesValue);
    const valid = examplesValue.trim() !== "" && Number.isInteger(value) && value >= 1 && value <= 20;
    setExamplesRangeError(!valid);
    if (valid) saveExamples.mutate({ count: value });
  }

  async function retryPreview() {
    if (preview.isFetching || !preview.error) return;
    setRetriedError(preview.error);
    const result = await preview.refetch();
    setRetriedError(null);
    // Try again unmounts on success and on the no-examples error, so don't leave focus on nothing.
    if (result.isSuccess || result.error?.kind === "Validation") heading.current?.focus();
  }

  const previewError = preview.error ?? retriedError;
  const allowOverWindow = overWindow.isPending ? overWindow.variables.enabled : Boolean(settings.data?.allowOverWindow);

  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-4">
      <h3 ref={heading} id={`${id}-heading`} tabIndex={-1} className="text-sm font-medium">
        Model builds
      </h3>
      <p className="text-sm text-muted-foreground">
        A build is your base model plus examples from rows you reviewed, so it learns your choices.
      </p>

      {settings.isSuccess && (
        <form noValidate onSubmit={submitExamples} className="flex flex-col items-start gap-3">
          <TextField
            label="Examples per category"
            name="examplesPerCategory"
            type="number"
            inputMode="numeric"
            min={1}
            max={20}
            className="w-32"
            value={examplesValue}
            hint="How many reviewed rows of each category a build learns from."
            error={examplesError}
            announce
            onChange={(event) => {
              saveExamples.reset();
              setExamplesRangeError(false);
              setExamples(event.target.value);
            }}
          />
          <div className="flex items-center gap-3">
            <Button type="submit" variant="outline" aria-disabled={saveExamples.isPending}>
              {saveExamples.isPending ? "Saving…" : "Save"}
            </Button>
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {saveExamples.isSuccess ? "Saved." : ""}
            </p>
          </div>
          {saveExamples.isError && saveExamples.error.kind !== "Validation" && (
            <CommandErrorAlert title="Couldn't save the examples per category" error={saveExamples.error} />
          )}
        </form>
      )}

      {baseModel &&
        (previewError ? (
          <div className="flex flex-col items-start gap-3">
            {/* A new key remounts the alert, so a repeat failure is announced again. */}
            <CommandErrorAlert
              key={preview.errorUpdatedAt}
              title="Couldn't check Ollama's context window"
              error={previewError}
              // "Review some rows first" already says what to do.
              nextStep={previewError.kind === "Validation" ? "" : undefined}
            />
            {/* Trying again can't help until rows are reviewed. */}
            {previewError.kind !== "Validation" && (
              <Button variant="outline" aria-disabled={preview.isFetching} onClick={retryPreview}>
                {preview.isFetching ? "Trying again…" : "Try again"}
              </Button>
            )}
          </div>
        ) : !preview.data ? (
          <Skeleton role="status" aria-label="Checking Ollama's context window…" className="h-5 w-96 max-w-full" />
        ) : (
          <p aria-live="polite" className="text-sm">
            {previewText(preview.data, allowOverWindow)}
          </p>
        ))}
      {settings.isSuccess && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Checkbox
              id={`${id}-over-window`}
              aria-describedby={`${id}-over-window-hint`}
              aria-disabled={overWindow.isPending}
              className="aria-disabled:opacity-50"
              checked={allowOverWindow}
              onCheckedChange={(checked) => {
                if (overWindow.isPending) return;
                overWindow.mutate({ enabled: checked === true });
              }}
            />
            <Label htmlFor={`${id}-over-window`}>Use every example, even past Ollama's window</Label>
          </div>
          <p id={`${id}-over-window-hint`} className="pl-6 text-sm text-muted-foreground">
            For Ollama set up with a larger context and enough VRAM.
          </p>
          {overWindow.isError && (
            <CommandErrorAlert title="Couldn't save the window setting" error={overWindow.error} />
          )}
        </div>
      )}

      {rebuild && active && (
        <p className="text-sm">
          {active.name} is out of date: your categories changed since it was built. Rebuild so it learns the new list.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button aria-disabled={buildBlocked} aria-describedby={reason ? `${id}-reason` : undefined} onClick={build}>
          {building ? runningJobLabel(building) : start.isPending ? "Starting…" : rebuild ? "Rebuild" : "Build"}
        </Button>
        {reason && (
          <p id={`${id}-reason`} className="text-sm text-muted-foreground">
            {reason}
          </p>
        )}
      </div>
      {start.isError && (
        <CommandErrorAlert
          title="Couldn't start the build"
          error={start.error}
          // The message already says what to do; "Check your entries" doesn't fit a button with no fields.
          nextStep={start.error.kind === "Validation" ? "" : undefined}
        />
      )}
      {outcome?.error && (
        <CommandErrorAlert
          title={`Couldn't ${outcome.label.replace(/^Build/, "build")}`}
          error={{ kind: "Ollama", message: outcome.error }}
        />
      )}
      {job.isError && <CommandErrorAlert title="Couldn't check for a running build" error={job.error} />}

      {builds.isError ? (
        <CommandErrorAlert title="Couldn't load model builds" error={builds.error} />
      ) : builds.isPending ? (
        <Skeleton role="status" aria-label="Loading model builds…" className="h-16 w-full" />
      ) : builds.data.length === 0 ? (
        <Empty className="w-full border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BoxesIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>
              <h4>No builds yet</h4>
            </EmptyTitle>
            <EmptyDescription>Review some rows, then build a model that learns from them.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {builds.data.map((build) => (
            <li key={build.id} className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">{build.name}</span>
                  {build.active && <Badge>Active</Badge>}
                  {build.outOfDate && <Badge variant="outline">Out of date</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">
                  From {build.baseModel} on {formatDate(build.createdAt.slice(0, 10))},{" "}
                  {build.exampleCount === 1 ? "1 example" : `${build.exampleCount} examples`}
                </p>
              </div>
              <div className="flex gap-2">
                {!build.active && (
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Make ${build.name} active`}
                    aria-disabled={activate.isPending}
                    onClick={() => !activate.isPending && activate.mutate({ id: build.id })}
                  >
                    {activate.isPending && activate.variables?.id === build.id ? "Saving…" : "Make active"}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Delete ${build.name}`}
                  onClick={(event) => askDelete(build, event)}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {activate.isError && <CommandErrorAlert title="Couldn't make the build active" error={activate.error} />}

      <AlertDialog open={deleteOpen} onOpenChange={(next) => !remove.isPending && setDeleteOpen(next)}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            // The deleted row's buttons go away once the list refetches, so focus the heading instead.
            event.preventDefault();
            (remove.isSuccess ? heading.current : opener.current)?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {toDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It's removed from Ollama too.{toDelete?.active && " Zeni then categorizes with your base model."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {remove.isError && <CommandErrorAlert title="Couldn't delete the build" error={remove.error} />}
          <AlertDialogFooter>
            <AlertDialogCancel aria-disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              aria-disabled={remove.isPending}
              onClick={() => toDelete && !remove.isPending && remove.mutate({ id: toDelete.id })}
            >
              {remove.isPending ? "Deleting…" : "Delete build"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
