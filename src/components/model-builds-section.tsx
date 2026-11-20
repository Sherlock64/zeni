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
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useJobStatus } from "@/hooks/use-job-status";
import { activateBuild, deleteBuild, listBuilds, ollamaSettings, ollamaStatus, setExamplesPerCategory, startBuild } from "@/lib/commands";
import { runningJobLabel } from "@/lib/job-label";
import { formatDate } from "@/lib/dates";
import { BUILDS_KEY, JOB_STATUS_KEY, OLLAMA_SETTINGS_KEY, OLLAMA_STATUS_KEY } from "@/lib/query-keys";
import type { ModelBuild } from "@/types/bindings/ModelBuild";


export function ModelBuildsSection() {
  const queryClient = useQueryClient();
  const builds = useQuery({ queryKey: BUILDS_KEY, queryFn: listBuilds });
  const settings = useQuery({ queryKey: OLLAMA_SETTINGS_KEY, queryFn: ollamaSettings });
  const status = useQuery({ queryKey: OLLAMA_STATUS_KEY, queryFn: ollamaStatus });
  const job = useJobStatus();
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const [toDelete, setToDelete] = useState<ModelBuild | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [examples, setExamples] = useState<string | null>(null);
  const [examplesRangeError, setExamplesRangeError] = useState(false);
  // Show a build's outcome only when this section saw it run, so an old one doesn't linger.
  const [sawBuild, setSawBuild] = useState(false);

  // A build or a delete changes the models Ollama has installed.
  const refreshBuilds = () => {
    queryClient.invalidateQueries({ queryKey: BUILDS_KEY });
    queryClient.invalidateQueries({ queryKey: OLLAMA_STATUS_KEY });
  };
  const start = useMutation({
    mutationFn: startBuild,
    onSuccess: (started) => queryClient.setQueryData(JOB_STATUS_KEY, started),
  });
  const activate = useMutation({
    mutationFn: activateBuild,
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: OLLAMA_STATUS_KEY });
      await queryClient.invalidateQueries({ queryKey: BUILDS_KEY });
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
  const saveExamples = useMutation({
    mutationFn: setExamplesPerCategory,
    onSuccess: (saved) => queryClient.setQueryData(OLLAMA_SETTINGS_KEY, saved),
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
      queryClient.invalidateQueries({ queryKey: BUILDS_KEY });
      queryClient.invalidateQueries({ queryKey: OLLAMA_STATUS_KEY });
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
