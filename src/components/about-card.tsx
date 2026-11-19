import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { ReleaseNotesButton } from "@/components/release-notes-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useAppInfo } from "@/hooks/use-app-info";
import { useUpdateStatus } from "@/hooks/use-update-status";
import { checkForUpdates, setUpdateChecks } from "@/lib/commands";
import { formatDate } from "@/lib/dates";
import { UPDATE_STATUS_KEY } from "@/lib/query-keys";
import type { UpdateCheck } from "@/types/bindings/UpdateCheck";
import type { UpdateStatus } from "@/types/bindings/UpdateStatus";
import type { CommandError } from "@/types/command";
import type { InfoRowProps } from "@/types/ui";

export function InfoRow({ label, loading, children }: InfoRowProps) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{loading ? <Skeleton className="h-4 w-48" /> : children}</dd>
    </>
  );
}

function resultText(last: UpdateCheck | null) {
  if (!last) return "Not checked yet";
  const { result } = last;
  const text =
    result.state === "upToDate"
      ? "Up to date"
      : result.state === "newer"
        ? `Zeni ${result.version} is available`
        : `Check failed: ${result.reason}`;
  return `${text} (${formatDate(last.date)})`;
}

export function AboutCard() {
  const queryClient = useQueryClient();
  const info = useAppInfo();
  const update = useUpdateStatus();
  const switchId = useId();
  const hintId = useId();
  const aboutHeading = useRef<HTMLHeadingElement>(null);
  const focusSwitchOnMount = useRef(false);
  const setUpdateStatus = (status: UpdateStatus) => queryClient.setQueryData(UPDATE_STATUS_KEY, status);
  const check = useMutation({ mutationFn: checkForUpdates, onSuccess: setUpdateStatus });
  const toggle = useMutation({ mutationFn: setUpdateChecks, onSuccess: setUpdateStatus });
  const checking = check.isPending || Boolean(update.data?.checking);
  const checksEnabled = toggle.isPending ? toggle.variables.enabled : update.data?.checksEnabled;

  // A refetch clears the query's error while it runs, so keep showing the last one until the retry settles.
  const [retriedError, setRetriedError] = useState<CommandError | null>(null);
  const infoError = info.error ?? retriedError;

  const [retriedUpdateError, setRetriedUpdateError] = useState<CommandError | null>(null);
  const updateError = update.error ?? retriedUpdateError;

  async function retryUpdate() {
    if (update.isFetching || !update.error) return;
    setRetriedUpdateError(update.error);
    const result = await update.refetch();
    // The retry button unmounts on success, so focus moves to the switch that replaces it once it mounts.
    focusSwitchOnMount.current = result.isSuccess;
    setRetriedUpdateError(null);
  }

  function infoStatus() {
    if (infoError) return info.isFetching ? "Retrying…" : "";
    if (info.isPending) return "Loading app info…";
    if (updateError && update.isFetching) return "Retrying…";
    return "";
  }

  async function retryInfo() {
    if (info.isFetching || !info.error) return;
    setRetriedError(info.error);
    const result = await info.refetch();
    setRetriedError(null);
    // The retry button unmounts on success, so move focus to the loaded section.
    if (result.isSuccess) aboutHeading.current?.focus();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 ref={aboutHeading} tabIndex={-1}>
            About
          </h2>
        </CardTitle>
        <CardDescription>Version, update checks and storage details of this installation.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-6">
        {/* Always mounted, so screen readers announce each change to its text. */}
        <p role="status" className="sr-only">
          {infoStatus()}
        </p>
        {infoError ? (
          <div className="flex flex-col items-start gap-3">
            {/* A new key remounts the alert, so a repeat failure is announced again. */}
            <CommandErrorAlert key={info.errorUpdatedAt} title="Couldn't load app info" error={infoError} />
            {/* aria-disabled instead of disabled keeps keyboard focus on the button while busy. */}
            <Button variant="outline" onClick={retryInfo} aria-disabled={info.isFetching}>
              Try again
            </Button>
          </div>
        ) : (
          <dl aria-busy={info.isPending} className="grid grid-cols-[10rem_1fr] items-center gap-x-8 gap-y-3">
            <InfoRow label="Name" loading={info.isPending}>
              {info.data?.name}
            </InfoRow>
            <InfoRow label="Version" loading={info.isPending}>
              {info.data?.version}
            </InfoRow>
            <InfoRow label="Database" loading={info.isPending}>
              <span className="font-mono text-xs break-all">{info.data?.dbPath}</span>
            </InfoRow>
            <InfoRow label="Migrations applied" loading={info.isPending}>
              {info.data?.migrationsApplied}
            </InfoRow>
          </dl>
        )}

        {updateError ? (
          <div className="flex flex-col items-start gap-3">
            <CommandErrorAlert
              key={update.errorUpdatedAt}
              title="Couldn't load the update status"
              error={updateError}
              nextStep="Try again. If it keeps failing, restart Zeni."
            />
            <Button variant="outline" onClick={retryUpdate} aria-disabled={update.isFetching}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-3">
                <Switch
                  ref={(node) => {
                    if (node && focusSwitchOnMount.current) node.focus();
                    focusSwitchOnMount.current = false;
                  }}
                  id={switchId}
                  aria-describedby={hintId}
                  checked={checksEnabled ?? false}
                  aria-disabled={!update.data || toggle.isPending}
                  onCheckedChange={(enabled) => update.data && !toggle.isPending && toggle.mutate({ enabled })}
                />
                <Label htmlFor={switchId}>Check for updates daily</Label>
              </div>
              <p id={hintId} className="text-sm text-muted-foreground">
                Once a day, Zeni asks GitHub whether a newer version is out. It sends no personal data.
              </p>
            </div>
            <dl aria-busy={update.isPending} className="grid grid-cols-[10rem_1fr] items-center gap-x-8 gap-y-3">
              <InfoRow label="Last check" loading={update.isPending}>
                {/* Live, so the result of Check now is announced. */}
                <span aria-live="polite">{checking ? "Checking…" : resultText(update.data?.last ?? null)}</span>
              </InfoRow>
            </dl>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" aria-disabled={checking} onClick={() => !checking && check.mutate()}>
            {checking && <Loader2Icon aria-hidden="true" className="animate-spin" />}
            Check now
          </Button>
          <ReleaseNotesButton />
        </div>
        {toggle.isError && <CommandErrorAlert title="Couldn't save the setting" error={toggle.error} />}
        {check.isError && <CommandErrorAlert title="Couldn't check for updates" error={check.error} />}
      </CardContent>
    </Card>
  );
}
