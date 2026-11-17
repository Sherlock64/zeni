import { CircleAlertIcon, XIcon } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
  Validation: "Check your entries, then try again.",
  Backup: "Check that the backup folder exists and is writable, or choose another folder in Settings.",
  Import: "Nothing was imported. Check the file, or download it from your bank again, then retry.",
  Busy: "Wait for it to finish, or cancel it from the banner.",
};

// One Ollama kind covers a stopped server, a missing model and Ollama's own errors, so pick by message.
function defaultNextStep(error: CommandError) {
  if (error.kind !== "Ollama") return nextSteps[error.kind];
  if (/^Ollama (isn't running|stopped responding)/.test(error.message)) return "Check that Ollama is running, then try again.";
  if (error.message.startsWith("Pick a model")) return "Pick a base model in Settings → Ollama.";
  return "Fix the problem Ollama reports, then try again.";
}

// The backend quotes commands in backticks; show them as code. An odd count of backticks is left as typed.
function messageParts(message: string) {
  const parts = message.split("`");
  if (parts.length % 2 === 0) return message;
  return parts.map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part));
}

// role="alert" is an implicit assertive live region, so the error is announced when it appears.
export function CommandErrorAlert({ title, error, onDismiss, nextStep = defaultNextStep(error) }: CommandErrorAlertProps) {
  return (
    <Alert variant="destructive">
      <CircleAlertIcon aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Kind</dt>
          <dd className="font-mono">{error.kind}</dd>
          <dt className="text-muted-foreground">Message</dt>
          <dd className="break-words">{messageParts(error.message)}</dd>
        </dl>
        {nextStep && <p className="text-muted-foreground">{nextStep}</p>}
      </AlertDescription>
      {onDismiss && (
        <AlertAction>
          <Button variant="ghost" size="icon-sm" onClick={onDismiss} aria-label="Dismiss error">
            <XIcon aria-hidden="true" />
          </Button>
        </AlertAction>
      )}
    </Alert>
  );
}
