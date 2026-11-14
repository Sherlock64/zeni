import { CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { CommandError } from "@/types/command";
import type { CommandErrorAlertProps } from "@/types/ui";

const nextSteps: Partial<Record<CommandError["kind"], string>> = {
  Database: "Check that the folder exists and is writable, then restart Zeni.",
  Invoke: "The request never reached Zeni's backend. Restart Zeni and try again.",
  Locked: "Restart Zeni and unlock it with your master password, a recovery code or the system keyring.",
  WrongPassword: "Check the password and try again. Passwords are case-sensitive.",
  InvalidRecoveryCode: "Check the code against your saved list. Each code works only once.",
  NotFound: "It may have been removed. Reload the page and try again.",
  Crypto: "Zeni couldn't decrypt stored data. The database may be damaged or from another installation.",
};

// role="alert" is an implicit assertive live region, so the error is announced when it appears.
export function CommandErrorAlert({ title, error }: CommandErrorAlertProps) {
  return (
    <Alert variant="destructive">
      <CircleAlertIcon aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Kind</dt>
          <dd className="font-mono">{error.kind}</dd>
          <dt className="text-muted-foreground">Message</dt>
          <dd className="break-words">{error.message}</dd>
        </dl>
        {nextSteps[error.kind] && <p className="text-muted-foreground">{nextSteps[error.kind]}</p>}
      </AlertDescription>
    </Alert>
  );
}
