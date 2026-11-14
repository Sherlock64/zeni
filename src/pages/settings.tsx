import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TriangleAlertIcon } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { Page } from "@/components/page";
import { RecoveryCodes } from "@/components/recovery-codes";
import { TextField } from "@/components/text-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppInfo } from "@/hooks/use-app-info";
import { useSecurityStatus } from "@/hooks/use-security-status";
import { regenerateRecoveryCodes, sampleError } from "@/lib/commands";
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
    <Page title="Settings" description="Security and details of this installation of Zeni.">
      <SecurityCard />

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

function SecurityCard() {
  const status = useSecurityStatus();
  // The shell only shows Settings once unlocked.
  const security = status.data?.state === "unlocked" ? status.data : undefined;
  const codesLeft = security?.recoveryCodesLeft ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Security</h2>
        </CardTitle>
        <CardDescription>How Zeni protects the key to your encrypted account numbers.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-4">
        <dl aria-busy={!security} className="grid grid-cols-[max-content_1fr] items-center gap-x-8 gap-y-3">
          <InfoRow label="Keyring" loading={!security}>
            {security?.keyringSaved
              ? "Key saved in your system keyring"
              : "Not in your keyring — Zeni asks for your master password each time it starts"}
          </InfoRow>
          <InfoRow label="Recovery codes left" loading={!security}>
            {codesLeft}
          </InfoRow>
        </dl>
        {security && codesLeft <= 2 && (
          <Alert>
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle>{codesLeft === 0 ? "No recovery codes left" : `Only ${codesLeft} recovery ${codesLeft === 1 ? "code" : "codes"} left`}</AlertTitle>
            <AlertDescription>
              Generate a new set so you can still get in if you forget your master password.
            </AlertDescription>
          </Alert>
        )}
        <RegenerateCodesDialog />
      </CardContent>
    </Card>
  );
}

function RegenerateCodesDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [emptyError, setEmptyError] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const codesTitle = useRef<HTMLHeadingElement>(null);
  const mutation = useMutation({
    mutationFn: regenerateRecoveryCodes,
    gcTime: 0,
    onError: (error) => error.kind === "WrongPassword" && input.current?.focus(),
  });
  const wrongPassword = mutation.error?.kind === "WrongPassword";
  const codes = mutation.data?.codes;

  // The form unmounts when the codes appear, so move focus to their title.
  useEffect(() => {
    if (codes) codesTitle.current?.focus();
  }, [codes]);

  function openChange(next: boolean) {
    // The old codes stop working once new ones exist, so the dialog closes only through Continue.
    if (codes || mutation.isPending) return;
    setOpen(next);
    if (!next) {
      setPassword("");
      setEmptyError(false);
      mutation.reset();
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (mutation.isPending) return;
    setEmptyError(!password);
    if (!password) return input.current?.focus();
    mutation.mutate({ masterPassword: password });
  }

  function finish() {
    setOpen(false);
    setPassword("");
    mutation.reset();
    queryClient.invalidateQueries({ queryKey: ["security_status"] });
  }

  return (
    <AlertDialog open={open} onOpenChange={openChange}>
      <AlertDialogTrigger asChild>
        <Button variant="outline">Generate new recovery codes</Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        className="data-[size=default]:sm:max-w-lg"
        // Radix focuses Cancel by default; start in the password field instead.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          input.current?.focus();
        }}
      >
        {codes ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle ref={codesTitle} tabIndex={-1} className="outline-none">
                Save your new recovery codes
              </AlertDialogTitle>
              <AlertDialogDescription>Your old recovery codes no longer work.</AlertDialogDescription>
            </AlertDialogHeader>
            <RecoveryCodes codes={codes} onContinue={finish} />
          </>
        ) : (
          <form noValidate onSubmit={submit} className="flex flex-col gap-4">
            <AlertDialogHeader>
              <AlertDialogTitle>Generate new recovery codes?</AlertDialogTitle>
              <AlertDialogDescription>
                Zeni makes 8 new codes and all your old codes stop working, used or not. Enter your master password
                to continue.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <TextField
              ref={input}
              name="masterPassword"
              label="Master password"
              type="password"
              autoComplete="current-password"
              announce
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={emptyError ? "Enter your master password." : wrongPassword ? mutation.error?.message : undefined}
            />
            {mutation.isError && !wrongPassword && (
              <CommandErrorAlert title="Couldn't generate recovery codes" error={mutation.error} />
            )}
            <AlertDialogFooter>
              <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
              <Button type="submit" aria-disabled={mutation.isPending}>
                {mutation.isPending ? "Generating…" : "Generate codes"}
              </Button>
            </AlertDialogFooter>
          </form>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
