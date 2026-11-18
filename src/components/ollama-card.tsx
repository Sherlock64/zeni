import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyIcon } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { AutoCategorizeSwitch } from "@/components/auto-categorize-switch";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { ModelBuildsSection } from "@/components/model-builds-section";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useJobStatus, invalidateJobStatus } from "@/hooks/use-job-status";
import { cancelJob, ollamaSettings, ollamaStatus, setBaseModel, setOllamaPort, startModelDownload } from "@/lib/commands";
import { BUILDS_KEY, JOB_STATUS_KEY, OLLAMA_SETTINGS_KEY, OLLAMA_STATUS_KEY } from "@/lib/query-keys";
import type { RecommendedModel } from "@/types/bindings/RecommendedModel";

// Ollama treats "name" and "name:latest" as the same model.
const sameModel = (a: string, b: string) => a.replace(/:latest$/, "") === b.replace(/:latest$/, "");
const formatSize = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;
// The backend labels a download job "Download <model>".
const modelOf = (label: string) => label.replace(/^Download /, "");

export function OllamaCard() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: OLLAMA_SETTINGS_KEY, queryFn: ollamaSettings });
  const status = useQuery({ queryKey: OLLAMA_STATUS_KEY, queryFn: ollamaStatus });
  const job = useJobStatus();
  const heading = useRef<HTMLHeadingElement>(null);
  const busyId = useId();
  const pickerId = useId();

  const [port, setPort] = useState<string | null>(null);
  const [portRangeError, setPortRangeError] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [toDownload, setToDownload] = useState<RecommendedModel | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  // Show a download's outcome only when this card saw it run, so an old one doesn't linger.
  const [sawDownload, setSawDownload] = useState(false);

  const savePort = useMutation({
    mutationFn: setOllamaPort,
    onSuccess: (saved) => {
      queryClient.setQueryData(OLLAMA_SETTINGS_KEY, saved);
      queryClient.invalidateQueries({ queryKey: OLLAMA_STATUS_KEY });
    },
  });
  const saveModel = useMutation({
    mutationFn: setBaseModel,
    onSuccess: (saved) => {
      queryClient.setQueryData(OLLAMA_SETTINGS_KEY, saved);
      // Picking a base model deactivates the active build.
      queryClient.invalidateQueries({ queryKey: BUILDS_KEY });
    },
  });
  const download = useMutation({
    mutationFn: startModelDownload,
    onSuccess: (started) => queryClient.setQueryData(JOB_STATUS_KEY, started),
  });
  const cancel = useMutation({ mutationFn: cancelJob, onSuccess: () => invalidateJobStatus(queryClient) });

  const running = job.data?.running ?? null;
  const downloading = running?.kind === "download" ? running : null;
  const outcome = sawDownload && !running && job.data?.last?.kind === "download" ? job.data.last : null;

  // When a download ends, the installed models and the base model have changed.
  const wasDownloading = useRef(false);
  useEffect(() => {
    if (downloading) {
      wasDownloading.current = true;
      setSawDownload(true);
    } else if (wasDownloading.current) {
      wasDownloading.current = false;
      queryClient.invalidateQueries({ queryKey: OLLAMA_STATUS_KEY });
      queryClient.invalidateQueries({ queryKey: OLLAMA_SETTINGS_KEY });
      // The progress bar and its Cancel button are gone, so don't leave focus on nothing.
      if (document.activeElement === document.body) heading.current?.focus();
    }
  }, [downloading, queryClient]);

  const portValue = port ?? String(settings.data?.port ?? "");
  const portError = portRangeError
    ? "Enter a port from 1 to 65535."
    : savePort.error?.kind === "Validation"
      ? savePort.error.message
      : undefined;

  function submitPort(event: FormEvent) {
    event.preventDefault();
    if (savePort.isPending) return;
    // Mirrors the backend's range.
    const value = Number(portValue);
    const valid = portValue.trim() !== "" && Number.isInteger(value) && value >= 1 && value <= 65535;
    setPortRangeError(!valid);
    if (valid) savePort.mutate({ port: value });
  }

  async function checkAgain() {
    if (status.isFetching) return;
    const fromError = status.isError;
    const result = await status.refetch();
    // The error alert and its button unmount on success, so don't leave focus on nothing.
    if (fromError && result.isSuccess) heading.current?.focus();
  }

  const checkAgainButton = (
    <Button variant="outline" size="sm" aria-disabled={status.isFetching} onClick={checkAgain}>
      {status.isFetching ? "Checking…" : "Check again"}
    </Button>
  );

  async function copy(command: string) {
    try {
      await navigator.clipboard.writeText(command);
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Couldn't copy. Select the command and copy it by hand.");
    }
  }

  function askDownload(model: RecommendedModel, button: HTMLButtonElement) {
    if (running || download.isPending) return;
    opener.current = button;
    download.reset();
    setToDownload(model);
    setConfirmOpen(true);
  }

  function confirmDownload() {
    if (!toDownload || download.isPending) return;
    download.mutate({ name: toDownload.name });
    setConfirmOpen(false);
  }

  const installed = status.data?.installed ?? [];
  const recommended = status.data?.recommended ?? [];
  const baseModel = settings.data?.baseModel ?? null;
  const picked = baseModel ? (installed.find((model) => sameModel(model.name, baseModel))?.name ?? "") : "";
  const pullCommand = `ollama pull ${recommended[0]?.name ?? "phi4-mini"}`;
  const needsHelp = status.data && (!status.data.reachable || installed.length === 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 ref={heading} tabIndex={-1}>
            Ollama
          </h2>
        </CardTitle>
        <CardDescription>The local model that categorizes your transactions.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {settings.isError ? (
          <CommandErrorAlert title="Couldn't load Ollama settings" error={settings.error} />
        ) : settings.isPending ? (
          <Skeleton role="status" aria-label="Loading Ollama settings…" className="h-16 w-64" />
        ) : (
          <form noValidate onSubmit={submitPort} className="flex flex-col items-start gap-3">
            <TextField
              label="Port"
              name="port"
              type="number"
              inputMode="numeric"
              min={1}
              max={65535}
              className="w-32"
              value={portValue}
              hint="Zeni only talks to Ollama on this computer. Its default port is 11434."
              error={portError}
              announce
              onChange={(event) => {
                savePort.reset();
                setPortRangeError(false);
                setPort(event.target.value);
              }}
            />
            <div className="flex items-center gap-3">
              <Button type="submit" variant="outline" aria-disabled={savePort.isPending}>
                {savePort.isPending ? "Saving…" : "Save"}
              </Button>
              <p aria-live="polite" className="text-sm text-muted-foreground">
                {savePort.isSuccess ? "Saved." : ""}
              </p>
            </div>
            {savePort.isError && savePort.error.kind !== "Validation" && (
              <CommandErrorAlert title="Couldn't save the port" error={savePort.error} />
            )}
          </form>
        )}

        {status.isError ? (
          <div className="flex flex-col items-start gap-3">
            {/* A new key remounts the alert, so a repeat failure is announced again. */}
            <CommandErrorAlert key={status.errorUpdatedAt} title="Couldn't check Ollama" error={status.error} />
            {checkAgainButton}
          </div>
        ) : status.isPending ? (
          <Skeleton role="status" aria-label="Checking Ollama…" className="h-24 w-full" />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <p role="status" className="text-sm">
                {status.data.reachable
                  ? status.data.version
                    ? `Ollama ${status.data.version} is running.`
                    : "Ollama is running."
                  : `Ollama isn't reachable on port ${settings.data?.port ?? 11434}.`}
              </p>
              {checkAgainButton}
            </div>

            {needsHelp && (
              <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4 text-sm">
                {status.data.reachable ? (
                  <p>Ollama has no models yet. Download one below, or pull one in a terminal:</p>
                ) : (
                  <p>
                    Install Ollama from ollama.com and start it with <code className="font-mono">ollama serve</code>, or
                    check the port above. Then pull a model in a terminal:
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <code className="rounded-md bg-background px-3 py-2 font-mono select-all">{pullCommand}</code>
                  <Button variant="outline" size="sm" onClick={() => copy(pullCommand)}>
                    <CopyIcon aria-hidden="true" />
                    Copy
                  </Button>
                  {/* Always mounted, so screen readers announce each change to its text. */}
                  <p role="status" className="text-muted-foreground">
                    {copyStatus}
                  </p>
                </div>
              </div>
            )}

            {status.data.reachable && (
              <div className="flex flex-col items-start gap-2">
                <Label htmlFor={pickerId}>Base model</Label>
                <div className="flex items-center gap-3">
                  <Select
                    value={picked}
                    disabled={installed.length === 0}
                    onValueChange={(name) => !saveModel.isPending && saveModel.mutate({ name })}
                  >
                    <SelectTrigger id={pickerId} className="w-64" aria-disabled={saveModel.isPending}>
                      <SelectValue placeholder={installed.length ? "Pick a model" : "No models installed"} />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {installed.map((model) => (
                        <SelectItem key={model.name} value={model.name}>
                          {model.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p aria-live="polite" className="text-sm text-muted-foreground">
                    {saveModel.isPending ? "Saving…" : saveModel.isSuccess ? "Saved." : ""}
                  </p>
                </div>
                {saveModel.isError && <CommandErrorAlert title="Couldn't save the base model" error={saveModel.error} />}
              </div>
            )}

            <section aria-labelledby={`${busyId}-heading`} className="flex flex-col gap-3">
              <h3 id={`${busyId}-heading`} className="text-sm font-medium">
                Recommended models
              </h3>
              {/* A download shows its own progress below. */}
              {status.data.reachable && running && !downloading && (
                <p id={busyId} className="text-sm text-muted-foreground">
                  {running.label} is running.
                </p>
              )}
              <ul className="flex flex-col divide-y rounded-lg border">
                {recommended.map((model) => (
                  <li key={model.name} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm">{model.name}</span>
                        <span className="text-sm text-muted-foreground">{formatSize(model.sizeBytes)}</span>
                        {model.installed && <Badge variant="secondary">Installed</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">{model.note}</p>
                    </div>
                    {status.data.reachable && !model.installed && (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Download ${model.name}`}
                        aria-disabled={Boolean(running) || download.isPending}
                        aria-describedby={downloading ? `${busyId}-progress-label` : running ? busyId : undefined}
                        onClick={(event) => askDownload(model, event.currentTarget)}
                      >
                        Download
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}

        {job.isError && <CommandErrorAlert title="Couldn't check for a running download" error={job.error} />}
        {download.isError && <CommandErrorAlert title="Couldn't start the download" error={download.error} />}

        {downloading && (
          <div className="flex flex-col gap-2">
            <Label id={`${busyId}-progress-label`} htmlFor={`${busyId}-progress`}>
              Downloading {modelOf(downloading.label)}
              {downloading.total > 0 && ` (${formatSize(downloading.done)} of ${formatSize(downloading.total)})`}
            </Label>
            <div className="flex items-center gap-3">
              {/* A total of 0 is unknown, so the bar stays indeterminate. */}
              <progress
                id={`${busyId}-progress`}
                className="h-2 flex-1 overflow-hidden rounded-full bg-muted [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary"
                max={downloading.total || undefined}
                value={downloading.total ? downloading.done : undefined}
              />
              <Button variant="outline" size="sm" aria-disabled={cancel.isPending} onClick={() => !cancel.isPending && cancel.mutate()}>
                {cancel.isPending ? "Cancelling…" : "Cancel"}
              </Button>
            </div>
          </div>
        )}
        {cancel.isError && <CommandErrorAlert title="Couldn't cancel the download" error={cancel.error} />}

        <p aria-live="polite" className="text-sm text-muted-foreground empty:hidden">
          {outcome && !outcome.error
            ? outcome.cancelled
              ? `Cancelled the download of ${modelOf(outcome.label)}.`
              : `Downloaded ${modelOf(outcome.label)}. It's now your base model.`
            : ""}
        </p>
        {outcome?.error && (
          <CommandErrorAlert
            title={`Couldn't download ${modelOf(outcome.label)}`}
            error={{ kind: "Ollama", message: outcome.error }}
          />
        )}

        <AutoCategorizeSwitch />
        <ModelBuildsSection />
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              Download {toDownload?.name} ({toDownload && formatSize(toDownload.sizeBytes)})?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Ollama downloads it in the background while Zeni is open. When it finishes, it becomes your base model.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button onClick={confirmDownload}>Download</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
