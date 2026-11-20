import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { acknowledgeReleaseNotes, releaseNotes } from "@/lib/commands";
import { RELEASE_NOTES_KEY } from "@/lib/query-keys";
import type { ReleaseNote } from "@/types/bindings/ReleaseNote";
import type { ReleaseNotes } from "@/types/bindings/ReleaseNotes";
import type { CommandError } from "@/types/command";

const TITLE = "What's new in Zeni";
const contentClass = "max-h-[85svh] overflow-y-auto sm:max-w-lg";

// A line starting "- " is a list item and any other line a paragraph; neighbouring items share one list.
function sections(notes: ReleaseNote[]) {
  return notes.map(({ version, lines }) => {
    const blocks: (string | string[])[] = [];
    for (const line of lines) {
      const last = blocks.at(-1);
      if (!line.startsWith("- ")) blocks.push(line);
      else if (Array.isArray(last)) last.push(line.slice(2));
      else blocks.push([line.slice(2)]);
    }
    return (
      <section key={version} className="flex flex-col gap-2">
        <h3 className="font-semibold">{version}</h3>
        {blocks.map((block, i) =>
          Array.isArray(block) ? (
            <ul key={i} className="ml-5 list-disc space-y-1">
              {block.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          ) : (
            <p key={i}>{block}</p>
          ),
        )}
      </section>
    );
  });
}

// After an update: opens once with the pending sections; closing it acknowledges them.
export function PendingReleaseNotes() {
  const queryClient = useQueryClient();
  const notes = useQuery({ queryKey: RELEASE_NOTES_KEY, queryFn: releaseNotes });
  const [closed, setClosed] = useState(false);
  // A failed acknowledge only means the notes show again next launch.
  const acknowledge = useMutation({
    mutationFn: acknowledgeReleaseNotes,
    onSuccess: () => queryClient.setQueryData<ReleaseNotes>(RELEASE_NOTES_KEY, (old) => old && { ...old, pending: [] }),
  });
  const pending = notes.data?.pending ?? [];

  function close() {
    setClosed(true);
    acknowledge.mutate();
  }

  return (
    <Dialog open={!closed && pending.length > 0} onOpenChange={(open) => !open && close()}>
      <DialogContent
        className={contentClass}
        // Nothing opened it, so return focus to the page heading.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document.querySelector<HTMLElement>("main h1")?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{TITLE}</DialogTitle>
          <DialogDescription>What changed since you last used Zeni.</DialogDescription>
        </DialogHeader>
        {sections(pending)}
      </DialogContent>
    </Dialog>
  );
}

// Release notes in Settings > About: every section, and closing acknowledges nothing.
export function ReleaseNotesButton() {
  const notes = useQuery({ queryKey: RELEASE_NOTES_KEY, queryFn: releaseNotes });
  const content = useRef<HTMLDivElement>(null);
  // A refetch with no data resets the query to pending, so keep the error and Try again up meanwhile.
  const [retriedError, setRetriedError] = useState<CommandError | null>(null);
  const error = notes.error ?? retriedError;

  async function retry() {
    if (notes.isFetching || !notes.error) return;
    setRetriedError(notes.error);
    const result = await notes.refetch();
    setRetriedError(null);
    // Try again goes away once the notes load, so keep focus in the dialog.
    if (result.isSuccess) content.current?.focus();
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Release notes</Button>
      </DialogTrigger>
      <DialogContent ref={content} className={contentClass}>
        <DialogHeader>
          <DialogTitle>{TITLE}</DialogTitle>
          <DialogDescription>Every version of Zeni, newest first.</DialogDescription>
        </DialogHeader>
        {/* Always mounted, so screen readers announce the loading text and its clearing. */}
        <p role="status" className="sr-only">
          {notes.isPending ? "Loading release notes…" : ""}
        </p>
        {error ? (
          <div className="flex flex-col items-start gap-3">
            <CommandErrorAlert
              key={notes.errorUpdatedAt}
              title="Couldn't load the release notes"
              error={error}
              nextStep="Try again. If it keeps failing, restart Zeni."
            />
            <Button variant="outline" onClick={retry} aria-disabled={notes.isFetching}>
              {notes.isFetching ? "Trying again…" : "Try again"}
            </Button>
          </div>
        ) : !notes.data ? (
          <Skeleton aria-hidden="true" className="h-32 w-full" />
        ) : notes.data.all.length === 0 ? (
          <p className="text-muted-foreground">No release notes yet.</p>
        ) : (
          sections(notes.data.all)
        )}
      </DialogContent>
    </Dialog>
  );
}
