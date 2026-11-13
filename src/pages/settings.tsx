import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppInfo } from "@/hooks/use-app-info";
import { sampleError } from "@/lib/commands";
import type { CommandError } from "@/types/command";
import type { InfoRowProps } from "@/types/ui";

function InfoRow({ label, loading, children }: InfoRowProps) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{loading ? <Skeleton className="h-4 w-48" /> : children}</dd>
    </>
  );
}

export function SettingsPage() {
  const info = useAppInfo();
  const sample = useMutation({ mutationFn: () => sampleError({ reason: "triggered from Settings" }) });
  const aboutHeading = useRef<HTMLHeadingElement>(null);

  // A refetch clears the query's error while it runs, so keep showing the last one until the retry settles.
  const [retriedError, setRetriedError] = useState<CommandError | null>(null);
  const infoError = info.error ?? retriedError;

  function infoStatus() {
    if (infoError) return info.isFetching ? "Retrying…" : "";
    if (info.isPending) return "Loading app info…";
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
    <Page title="Settings" description="About this installation of Zeni.">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 ref={aboutHeading} tabIndex={-1}>
              About
            </h2>
          </CardTitle>
          <CardDescription>Version and storage details reported by the backend.</CardDescription>
        </CardHeader>
        <CardContent>
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
            <dl aria-busy={info.isPending} className="grid grid-cols-[max-content_1fr] items-center gap-x-8 gap-y-3">
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Error handling</h2>
          </CardTitle>
          <CardDescription>Ask the backend for a sample error to check how errors are shown.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-4">
          <Button variant="outline" onClick={() => !sample.isPending && sample.mutate()} aria-disabled={sample.isPending}>
            Trigger sample error
          </Button>
          {sample.isError && <CommandErrorAlert title="Sample command failed" error={sample.error} />}
        </CardContent>
      </Card>
    </Page>
  );
}
