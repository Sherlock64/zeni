import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TextFieldProps } from "@/types/ui";

// A label, an input, and its hint or error wired up with aria-describedby. The error replaces the hint.
export function TextField({ label, hint: hintText, error, announce, ...props }: TextFieldProps) {
  const id = useId();
  const hint = !error && hintText;
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy || undefined} {...props} />
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role={announce ? "alert" : undefined} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
