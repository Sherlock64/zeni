// After a failed submit, moves focus to the first invalid control in document order, so the error is read out.
export function focusFirstInvalid(container: HTMLElement | null) {
  container?.querySelector<HTMLElement>(':is(input, button, select, textarea)[aria-invalid="true"]')?.focus();
}
