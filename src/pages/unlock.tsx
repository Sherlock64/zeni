import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useRef, useState } from "react";
import { flushSync } from "react-dom";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { recover, resetSecurity, unlock } from "@/lib/commands";
import { masterPasswordErrors } from "@/lib/validation";
import type { LockReason } from "@/types/bindings/LockReason";
import type { FieldErrors, UnlockPageProps } from "@/types/ui";

const reasons: Record<LockReason, string> = {
  keyringLocked: "Your system keyring is locked, so Zeni can't read its key from it.",
  keyringUnavailable: "Zeni couldn't reach your system keyring.",
  keyMissing: "Zeni's key isn't in your system keyring. Once you unlock, Zeni saves it there again if it can.",
};

// Same rules as the backend: uppercase, drop spaces and dashes, then 20 Crockford base32 characters.
export const recoveryCodeValid = (code: string) => /^[0-9A-HJKMNP-TV-Z]{20}$/.test(code.toUpperCase().replace(/[\s-]/g, ""));

export function UnlockPage({ reason }: UnlockPageProps) {
  const [mode, setMode] = useState<"password" | "recovery">("password");
  const heading = useRef<HTMLHeadingElement>(null);

  function switchTo(next: typeof mode) {
    flushSync(() => setMode(next));
    // The button that was clicked unmounted with the form, so move focus to the heading.
    heading.current?.focus();
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>
          <h1 ref={heading} tabIndex={-1} className="text-xl font-semibold tracking-tight">
            {mode === "password" ? "Unlock Zeni" : "Use a recovery code"}
          </h1>
        </CardTitle>
        <CardDescription>
          {mode === "password"
            ? `${reasons[reason]} Enter your master password to unlock.`
            : "Enter one of your saved recovery codes and choose a new master password. The code then stops working."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {mode === "password" ? <PasswordForm /> : <RecoveryForm />}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4">
          {mode === "password" ? (
            <Button variant="link" className="px-0" onClick={() => switchTo("recovery")}>
              Use a recovery code
            </Button>
          ) : (
            <Button variant="link" className="px-0" onClick={() => switchTo("password")}>
              Use the master password
            </Button>
          )}
          <ResetDialog />
        </div>
      </CardContent>
    </Card>
  );
}

const useRefetchStatus = () => {
  const queryClient = useQueryClient();
  // Returning the promise keeps the mutation pending until the gate has the new status.
  return () => queryClient.invalidateQueries({ queryKey: ["security_status"] });
};

function PasswordForm() {
  const onSuccess = useRefetchStatus();
  const [password, setPassword] = useState("");
  const [emptyError, setEmptyError] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const mutation = useMutation({
    mutationFn: unlock,
    gcTime: 0,
    onSuccess,
    onError: (error) => error.kind === "WrongPassword" && input.current?.focus(),
  });
  const wrongPassword = mutation.error?.kind === "WrongPassword";

  function submit(event: FormEvent) {
    event.preventDefault();
    if (mutation.isPending) return;
    setEmptyError(!password);
    if (!password) return input.current?.focus();
    mutation.mutate({ masterPassword: password });
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      <TextField
        ref={input}
        name="masterPassword"
        label="Master password"
        type="password"
        autoComplete="current-password"
        autoFocus
        announce
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={emptyError ? "Enter your master password." : wrongPassword ? mutation.error?.message : undefined}
      />
      {mutation.isError && !wrongPassword && <CommandErrorAlert title="Couldn't unlock Zeni" error={mutation.error} />}
      <div>
        <Button type="submit" aria-disabled={mutation.isPending}>
          {mutation.isPending ? "Unlocking…" : "Unlock"}
        </Button>
      </div>
    </form>
  );
}

function RecoveryForm() {
  const onSuccess = useRefetchStatus();
  const [form, setForm] = useState({ recoveryCode: "", newMasterPassword: "", newMasterPasswordConfirm: "" });
  const [submitted, setSubmitted] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const focus = (name: string) => formRef.current?.querySelector<HTMLInputElement>(`[name="${name}"]`)?.focus();
  const mutation = useMutation({
    mutationFn: recover,
    gcTime: 0,
    onSuccess,
    onError: (error) => error.kind === "InvalidRecoveryCode" && focus("recoveryCode"),
  });
  const invalidCode = mutation.error?.kind === "InvalidRecoveryCode";

  const validate = () => ({
    ...(recoveryCodeValid(form.recoveryCode)
      ? {}
      : { recoveryCode: "Enter a 20-character code from your list, like ABCDE-FGHJK-MNPQR-STVWX." }),
    ...masterPasswordErrors(form.newMasterPassword, form.newMasterPasswordConfirm, "newMasterPassword"),
  });
  const errors: FieldErrors = submitted ? validate() : {};
  if (invalidCode && !errors.recoveryCode) errors.recoveryCode = mutation.error?.message;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (mutation.isPending) return;
    setSubmitted(true);
    const found = Object.keys(validate());
    if (found.length) return focus(found[0]);
    mutation.mutate({ recoveryCode: form.recoveryCode, newMasterPassword: form.newMasterPassword });
  }

  const field = (name: keyof typeof form) => ({
    name,
    value: form[name],
    error: errors[name],
    onChange: (event: { target: { value: string } }) => setForm({ ...form, [name]: event.target.value }),
  });

  return (
    <form ref={formRef} noValidate onSubmit={submit} className="flex flex-col gap-4">
      <TextField
        label="Recovery code"
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="characters"
        className="font-mono"
        {...field("recoveryCode")}
      />
      <TextField
        label="New master password"
        type="password"
        autoComplete="new-password"
        hint="At least 12 characters."
        {...field("newMasterPassword")}
      />
      <TextField
        label="Confirm new master password"
        type="password"
        autoComplete="new-password"
        {...field("newMasterPasswordConfirm")}
      />
      {mutation.isError && !invalidCode && <CommandErrorAlert title="Couldn't recover Zeni" error={mutation.error} />}
      <div>
        <Button type="submit" aria-disabled={mutation.isPending}>
          {mutation.isPending ? "Unlocking…" : "Set password and unlock"}
        </Button>
      </div>
    </form>
  );
}

function ResetDialog() {
  const onSuccess = useRefetchStatus();
  const mutation = useMutation({ mutationFn: resetSecurity, onSuccess });

  return (
    <AlertDialog onOpenChange={(open) => !open && mutation.reset()}>
      <AlertDialogTrigger asChild>
        <Button variant="link" className="px-0 text-muted-foreground">
          Can't unlock?
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="data-[size=default]:sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Erase and set up again?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">
              <p>
                Without your master password, a recovery code or the system keyring, Zeni can't decrypt the account
                and routing numbers it stored. Nobody can recover them.
              </p>
              <p>This erases Zeni's key and your checking account so you can run setup again. It can't be undone.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {mutation.isError && <CommandErrorAlert title="Couldn't erase" error={mutation.error} />}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {/* A plain button, not AlertDialogAction, so the dialog stays open to show a failure. */}
          <Button
            variant="destructive"
            aria-disabled={mutation.isPending}
            onClick={() => !mutation.isPending && mutation.mutate()}
          >
            {mutation.isPending ? "Erasing…" : "Erase and set up again"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
