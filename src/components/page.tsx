import { useId } from "react";
import type { PageProps } from "@/types/ui";

// Page and the categorize banner above it line up on this width and side padding.
export const PAGE_WIDTH = "mx-auto w-full max-w-screen-2xl px-8";

export function Page({ title, description, children }: PageProps) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className={`${PAGE_WIDTH} flex flex-1 flex-col gap-6 py-10`}>
      <header className="flex flex-col gap-1">
        <h1 id={headingId} tabIndex={-1} className="text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </header>
      {children}
    </section>
  );
}
