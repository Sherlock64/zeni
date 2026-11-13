import { useId } from "react";
import type { PageProps } from "@/types/ui";

export function Page({ title, description, children }: PageProps) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-8 py-10">
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
