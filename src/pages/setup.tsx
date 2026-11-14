import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TriangleAlertIcon } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { RecoveryCodes } from "@/components/recovery-codes";
import { TextField } from "@/components/text-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { completeSetup } from "@/lib/commands";
import { masterPasswordErrors } from "@/lib/validation";
import type { FieldErrors, SetupPageProps } from "@/types/ui";

const textError = (value: string, what: string) => {
  const length = [...value.trim()].length;
  if (length === 0) return `Enter ${what}.`;
  if (length > 100) return "Use at most 100 characters.";
};

const digits = (value: string) => value.replaceAll(" ", "");

export function routingNumberValid(value: string) {
  const number = digits(value);
  if (!/^\d{9}$/.test(number)) return false;
  const weights = [3, 7, 1];
  return [...number].reduce((sum, digit, i) => sum + Number(digit) * weights[i % 3], 0) % 10 === 0;
}

const initialForm = { masterPassword: "", masterPasswordConfirm: "", name: "Checking", bankName: "", accountNumber: "", routingNumber: "" };

function validate(form: typeof initialForm & { owner: string }): FieldErrors {
  const errors: FieldErrors = {
    ...masterPasswordErrors(form.masterPassword, form.masterPasswordConfirm),
    name: textError(form.name, "an account name"),
    owner: textError(form.owner, "the account owner"),
    bankName: textError(form.bankName, "the bank name"),
    accountNumber: /^\d{4,17}$/.test(digits(form.accountNumber)) ? undefined : "Use 4 to 17 digits.",
    routingNumber: routingNumberValid(form.routingNumber)
      ? undefined
      : "Enter a valid 9-digit routing number.",
  };
  return Object.fromEntries(Object.entries(errors).filter(([, message]) => message));
}

export function SetupPage({ defaultOwner }: SetupPageProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ ...initialForm, owner: defaultOwner });
  const [submitted, setSubmitted] = useState(false);
  const setup = useMutation({ mutationFn: completeSetup, gcTime: 0 });
  const formRef = useRef<HTMLFormElement>(null);
  const codesHeading = useRef<HTMLHeadingElement>(null);
  const errors = submitted ? validate(form) : {};

  // The form unmounts when the codes appear, so move focus to their heading.
  useEffect(() => {
    if (setup.data) codesHeading.current?.focus();
  }, [setup.data]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (setup.isPending) return;
    setSubmitted(true);
    const found = Object.keys(validate(form));
    if (found.length) {
      formRef.current?.querySelector<HTMLInputElement>(`[name="${found[0]}"]`)?.focus();
      return;
    }
    setup.mutate({
      masterPassword: form.masterPassword,
      account: {
        name: form.name,
        owner: form.owner,
        bankName: form.bankName,
        accountNumber: form.accountNumber,
        routingNumber: form.routingNumber,
      },
    });
  }

  const field = (name: keyof typeof form) => ({
    name,
    value: form[name],
    error: errors[name],
    onChange: (event: { target: { value: string } }) => setForm({ ...form, [name]: event.target.value }),
  });

  if (setup.data) {
    return (
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>
            <h1 ref={codesHeading} tabIndex={-1} className="text-xl font-semibold tracking-tight">
              Save your recovery codes
            </h1>
          </CardTitle>
          <CardDescription>
            If you forget your master password, any one of these codes lets you set a new one.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!setup.data.keyringSaved && (
            <Alert>
              <TriangleAlertIcon aria-hidden="true" />
              <AlertTitle>Your system keyring didn't save Zeni's key</AlertTitle>
              <AlertDescription>Zeni will ask for your master password each time it starts.</AlertDescription>
            </Alert>
          )}
          <RecoveryCodes
            codes={setup.data.recoveryCodes}
            onContinue={() => queryClient.invalidateQueries({ queryKey: ["security_status"] })}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex w-full max-w-lg flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 tabIndex={-1} className="text-2xl font-semibold tracking-tight">
          Set up Zeni
        </h1>
        <p className="text-sm text-muted-foreground">
          Zeni encrypts your account and routing numbers on this computer.
        </p>
      </header>
      <form ref={formRef} noValidate onSubmit={submit} className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Master password</h2>
            </CardTitle>
            <CardDescription>
              Zeni keeps its key in your system keyring. When the keyring is locked or unavailable, Zeni asks for
              this password instead.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <TextField
              label="Master password"
              type="password"
              autoComplete="new-password"
              hint="At least 12 characters."
              {...field("masterPassword")}
            />
            <TextField
              label="Confirm master password"
              type="password"
              autoComplete="new-password"
              {...field("masterPasswordConfirm")}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Checking account</h2>
            </CardTitle>
            <CardDescription>The account and routing numbers are stored encrypted.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Account name" autoComplete="off" {...field("name")} />
              <TextField label="Owner" autoComplete="off" {...field("owner")} />
            </div>
            <TextField label="Bank name" autoComplete="off" {...field("bankName")} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Account number"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                {...field("accountNumber")}
              />
              <TextField
                label="Routing number"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                {...field("routingNumber")}
              />
            </div>
          </CardContent>
        </Card>
        {setup.isError && <CommandErrorAlert title="Couldn't set up Zeni" error={setup.error} />}
        <div>
          <Button type="submit" aria-disabled={setup.isPending}>
            {setup.isPending ? "Setting up…" : "Set up Zeni"}
          </Button>
        </div>
      </form>
    </div>
  );
}
