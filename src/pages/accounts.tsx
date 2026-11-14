import { useMutation, useQuery } from "@tanstack/react-query";
import { EyeIcon, EyeOffIcon, LandmarkIcon } from "lucide-react";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { listAccounts, revealAccountNumbers } from "@/lib/commands";
import type { CommandError } from "@/types/command";
import type { AccountCardProps, SecretValueProps } from "@/types/ui";

export function AccountsPage() {
  const accounts = useQuery({ queryKey: ["list_accounts"], queryFn: listAccounts });
  const listHeading = useRef<HTMLHeadingElement>(null);

  // A refetch clears the query's error while it runs, so keep showing the last one until the retry settles.
  const [retriedError, setRetriedError] = useState<CommandError | null>(null);
  const error = accounts.error ?? retriedError;

  async function retry() {
    if (accounts.isFetching || !accounts.error) return;
    setRetriedError(accounts.error);
    const result = await accounts.refetch();
    // Render the list now so its heading exists to take focus; the retry button unmounts with the error.
    flushSync(() => setRetriedError(null));
    if (result.isSuccess) listHeading.current?.focus();
  }

  function status() {
    if (error) return accounts.isFetching ? "Retrying…" : "";
    if (accounts.isPending) return "Loading accounts…";
    return "";
  }

  return (
    <Page title="Accounts" description="Your bank accounts. Account and routing numbers are stored encrypted.">
      {/* Always mounted, so screen readers announce each change to its text. */}
      <p role="status" className="sr-only">
        {status()}
      </p>
      {error ? (
        <div className="flex flex-col items-start gap-3">
          {/* A new key remounts the alert, so a repeat failure is announced again. */}
          <CommandErrorAlert key={accounts.errorUpdatedAt} title="Couldn't load accounts" error={error} />
          <Button variant="outline" onClick={retry} aria-disabled={accounts.isFetching}>
            Try again
          </Button>
        </div>
      ) : !accounts.data ? (
        <Skeleton aria-hidden="true" className="h-48 w-full rounded-xl" />
      ) : accounts.data.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LandmarkIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>
              <h2 ref={listHeading} tabIndex={-1}>
                No accounts yet
              </h2>
            </EmptyTitle>
            <EmptyDescription>Accounts you add show up here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <section aria-labelledby="accounts-list" className="flex flex-col gap-4">
          <h2 id="accounts-list" ref={listHeading} tabIndex={-1} className="sr-only">
            Your accounts
          </h2>
          {accounts.data.map((account) => (
            <AccountCard key={account.id} account={account} />
          ))}
        </section>
      )}
    </Page>
  );
}

function SecretValue({ value }: SecretValueProps) {
  if (value) return <span className="font-mono tabular-nums">{value}</span>;
  return (
    <>
      <span aria-hidden="true" className="font-mono tracking-widest text-muted-foreground">
        ••••••••
      </span>
      <span className="sr-only">Hidden</span>
    </>
  );
}

function AccountCard({ account }: AccountCardProps) {
  // The numbers live only in this mutation's state: never in the query cache, gone on Hide or unmount.
  const reveal = useMutation({ mutationFn: revealAccountNumbers, gcTime: 0 });
  const numbers = reveal.data;

  function toggle() {
    if (reveal.isPending) return;
    if (numbers) reveal.reset();
    else reveal.mutate({ accountId: account.id });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h3>{account.name}</h3>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-[max-content_1fr] items-center gap-x-8 gap-y-3 text-sm">
          <dt className="text-muted-foreground">Owner</dt>
          <dd className="break-words">{account.owner}</dd>
          <dt className="text-muted-foreground">Bank</dt>
          <dd className="break-words">{account.bankName}</dd>
          <dt className="text-muted-foreground">Account number</dt>
          <dd>
            <SecretValue value={numbers?.accountNumber} />
          </dd>
          <dt className="text-muted-foreground">Routing number</dt>
          <dd>
            <SecretValue value={numbers?.routingNumber} />
          </dd>
        </dl>
        {reveal.isError && <CommandErrorAlert title="Couldn't show the numbers" error={reveal.error} />}
        <div>
          <Button variant="outline" onClick={toggle} aria-disabled={reveal.isPending}>
            {numbers ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
            {numbers ? "Hide numbers" : "Show numbers"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
