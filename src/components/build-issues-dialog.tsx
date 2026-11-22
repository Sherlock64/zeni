import { TriangleAlertIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { BuildPreview } from "@/types/bindings/BuildPreview";
import type { ModelBuild } from "@/types/bindings/ModelBuild";
import type { BuildIssue } from "@/types/ui";

/** What's wrong with a build: too many examples for the window (unless the override is on), or out of date. */
export function buildIssues(build: ModelBuild, preview: BuildPreview | undefined, allowOverWindow: boolean): BuildIssue[] {
  const issues: BuildIssue[] = [];
  // A build made before 7.2 may hold more examples than the window, which stalls categorizing.
  if (preview && !allowOverWindow && build.exampleCount > preview.fit)
    issues.push({
      title: "Larger than Ollama's window",
      detail: `It has ${build.exampleCount} examples; Ollama's ${preview.windowTokens.toLocaleString("en-US")}-token window fits ${preview.fit}. Categorizing with it may stall. Rebuild to fit.`,
    });
  if (build.outOfDate)
    issues.push({
      title: "Out of date",
      detail: "Your categories changed since it was built, so it doesn't know the new list. Rebuild so it learns it.",
    });
  return issues;
}

/** A warning pill on a build's row that opens a dialog detailing each issue. */
export function BuildIssuesDialog({ name, issues }: { name: string; issues: BuildIssue[] }) {
  const count = issues.length === 1 ? "1 issue" : `${issues.length} issues`;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Badge asChild variant="outline" className="border-warning/60 text-warning">
          <button type="button" aria-label={`${count} with ${name}`}>
            <TriangleAlertIcon aria-hidden="true" />
            {count}
          </button>
        </Badge>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {count} with {name}
          </DialogTitle>
          <DialogDescription>Rebuild fixes each of these.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-3 text-sm">
          {issues.map((issue) => (
            <li key={issue.title} className="flex gap-2">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              <div>
                <p className="font-medium">{issue.title}</p>
                <p className="text-muted-foreground">{issue.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
