import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVerticalIcon, ListIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { CategoryDeleteDialog } from "@/components/category-delete-dialog";
import { CategoryForm, kindLabels } from "@/components/category-form";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { Page } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useJobStatus } from "@/hooks/use-job-status";
import { listCategories, reorderCategories } from "@/lib/commands";
import { CATEGORIES_KEY } from "@/lib/query-keys";
import type { Category } from "@/types/bindings/Category";
import type { JobKind } from "@/types/bindings/JobKind";
import type { CommandError } from "@/types/command";
import type { CategoryRowProps } from "@/types/ui";

const categorizeKinds: JobKind[] = ["categorizeNow", "recategorizeAll", "afterImport"];

function CategoryRow({ category, position, total, locked, lockId, onEdit, onDelete }: CategoryRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: category.id,
    disabled: locked,
  });
  return (
    <li
      ref={setNodeRef}
      data-sort-index={position - 1}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-start gap-2 border-b bg-background px-2 py-3 last:border-b-0 ${isDragging ? "relative z-10 shadow-md" : ""}`}
    >
      <Button
        ref={setActivatorNodeRef}
        variant="ghost"
        size="icon-sm"
        className="cursor-grab touch-none"
        {...attributes}
        {...listeners}
        aria-label={`Move ${category.name}, position ${position} of ${total}`}
        aria-disabled={locked}
        aria-describedby={[attributes["aria-describedby"], lockId].filter(Boolean).join(" ")}
      >
        <GripVerticalIcon aria-hidden="true" />
      </Button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium wrap-anywhere">{category.name}</span>
          <Badge variant={category.kind === "spending" ? "outline" : "secondary"}>{kindLabels[category.kind]}</Badge>
        </span>
        {category.description && <span className="text-sm text-muted-foreground wrap-anywhere">{category.description}</span>}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Edit ${category.name}`}
        aria-disabled={locked}
        aria-describedby={lockId}
        onClick={(event) => !locked && onEdit(event.currentTarget)}
      >
        <PencilIcon aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Delete ${category.name}`}
        aria-disabled={locked}
        aria-describedby={lockId}
        data-category-delete={category.id}
        onClick={(event) => !locked && onDelete(event.currentTarget)}
      >
        <Trash2Icon aria-hidden="true" />
      </Button>
    </li>
  );
}

export function CategoriesPage() {
  const queryClient = useQueryClient();
  const lockId = useId();
  const categories = useQuery({ queryKey: CATEGORIES_KEY, queryFn: listCategories });
  // A refetch clears the query's error while it runs, so keep showing the last one until the retry settles.
  const [retriedError, setRetriedError] = useState<CommandError | null>(null);
  const listError = categories.error ?? retriedError;
  const job = useJobStatus();
  const running = job.data?.running;
  const locked = !!running && categorizeKinds.includes(running.kind);
  const [editing, setEditing] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // The button that opened the edit form or the delete dialog.
  const opener = useRef<HTMLElement | null>(null);

  const reorder = useMutation({
    mutationFn: (ids: number[]) => reorderCategories({ ids }),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: CATEGORIES_KEY });
      const previous = queryClient.getQueryData<Category[]>(CATEGORIES_KEY);
      const byId = new Map(previous?.map((category) => [category.id, category]));
      queryClient.setQueryData(
        CATEGORIES_KEY,
        ids.flatMap((id) => byId.get(id) ?? []),
      );
      return previous;
    },
    onError: (_error, _ids, previous) => queryClient.setQueryData(CATEGORIES_KEY, previous),
    onSettled: () => queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY }),
  });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const list = categories.data ?? [];
  const nameOf = (id: unknown) => list.find((category) => category.id === id)?.name ?? "";
  const positionOf = (id: unknown) => list.findIndex((category) => category.id === id) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}, position ${positionOf(active.id)} of ${list.length}.`,
    onDragOver: ({ active, over }) =>
      over ? `Moved ${nameOf(active.id)} to position ${positionOf(over.id)} of ${list.length}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over ? `Moved ${nameOf(active.id)} to position ${positionOf(over.id)} of ${list.length}.` : `Dropped ${nameOf(active.id)}.`,
    onDragCancel: ({ active }) => `Put ${nameOf(active.id)} back at position ${positionOf(active.id)} of ${list.length}.`,
  };

  function dragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id || locked || reorder.isPending) return;
    const ids = list.map((category) => category.id);
    reorder.mutate(arrayMove(ids, ids.indexOf(Number(active.id)), ids.indexOf(Number(over.id))));
  }

  function startEdit(category: Category, from: HTMLElement) {
    opener.current = from;
    setEditing(category);
  }

  function doneEditing() {
    // After an add there's no opener to go back to; focus stays on the form.
    if (editing && opener.current?.isConnected) opener.current.focus();
    setEditing(null);
  }

  function startDelete(category: Category, from: HTMLElement) {
    opener.current = from;
    setDeleting(category);
    setDeleteOpen(true);
  }

  function returnFocus(event: Event) {
    event.preventDefault();
    // A deleted category's button is gone, so fall back to the page heading.
    if (opener.current?.isConnected) opener.current.focus();
    else document.querySelector<HTMLElement>("main h1")?.focus();
  }

  async function retry() {
    if (categories.isFetching || !categories.error) return;
    setRetriedError(categories.error);
    const result = await categories.refetch();
    setRetriedError(null);
    // The retry button unmounts on success, so move focus to the page heading.
    if (result.isSuccess) document.querySelector<HTMLElement>("main h1")?.focus();
  }

  function content() {
    if (listError) {
      return (
        <div className="flex flex-col items-start gap-3">
          {/* A new key remounts the alert, so a repeat failure is announced again. */}
          <CommandErrorAlert key={categories.errorUpdatedAt} title="Couldn't load categories" error={listError} />
          <Button variant="outline" onClick={retry} aria-disabled={categories.isFetching}>
            {categories.isFetching ? "Trying again…" : "Try again"}
          </Button>
        </div>
      );
    }
    if (!categories.data) {
      return (
        <div aria-hidden="true" className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      );
    }
    if (list.length === 0) {
      return (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ListIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>
              <h2>No categories yet.</h2>
            </EmptyTitle>
            <EmptyDescription>Add your first category with the form above.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      );
    }
    return (
      <section aria-labelledby={`${lockId}-list`} className="flex flex-col gap-2">
        <h2 id={`${lockId}-list`} className="text-lg font-semibold">
          Your categories
        </h2>
        <p className="text-sm text-muted-foreground">Drag a handle, or focus it and press Space, to change the order.</p>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd} accessibility={{ announcements }}>
          <SortableContext items={list.map((category) => category.id)} strategy={verticalListSortingStrategy}>
            <ol aria-label="Categories" aria-busy={reorder.isPending} className="overflow-hidden rounded-xl border">
              {list.map((category, index) => (
                <CategoryRow
                  key={category.id}
                  category={category}
                  position={index + 1}
                  total={list.length}
                  locked={locked || reorder.isPending}
                  lockId={locked ? lockId : undefined}
                  onEdit={(from) => startEdit(category, from)}
                  onDelete={(from) => startDelete(category, from)}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      </section>
    );
  }

  return (
    <Page title="Categories" description="The list every transaction's category comes from.">
      {/* Always mounted, so screen readers announce each change to its text. */}
      <p role="status" className="sr-only">
        {listError ? (categories.isFetching ? "Retrying…" : "") : categories.isPending ? "Loading categories…" : ""}
      </p>
      {locked && (
        <p id={lockId} className="rounded-lg border bg-muted px-4 py-3 text-sm">
          Wait for categorizing to finish. {running?.label} is running, so categories can't change until it's done.
        </p>
      )}
      {reorder.isError && (
        <CommandErrorAlert
          title="Couldn't save the order. Try again."
          error={reorder.error}
          nextStep="The order was put back."
          onDismiss={reorder.reset}
        />
      )}
      <CategoryForm editing={editing} onDone={doneEditing} locked={locked} lockId={lockId} />
      {content()}
      <CategoryDeleteDialog
        key={deleting?.id}
        category={deleting}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onCloseAutoFocus={returnFocus}
      />
    </Page>
  );
}
