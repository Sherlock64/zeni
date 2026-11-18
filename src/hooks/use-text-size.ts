import { useSyncExternalStore } from "react";
import type { TextSize } from "@/types/ui";

export const TEXT_SIZES: readonly TextSize[] = [90, 100, 115, 130, 150];
const STORAGE_KEY = "zeni.textSize";
const listeners = new Set<() => void>();
let current: TextSize = 100;

function loadTextSize(): TextSize {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return TEXT_SIZES.find((size) => size === saved) ?? 100;
  } catch {
    return 100;
  }
}

function apply(size: TextSize) {
  current = size;
  // Tailwind sizes are rem, so the root font size scales the whole app.
  document.documentElement.style.fontSize = size === 100 ? "" : `${size}%`;
  listeners.forEach((listener) => listener());
}

export function setTextSize(size: TextSize) {
  apply(size);
  try {
    localStorage.setItem(STORAGE_KEY, String(size));
  } catch {
    // Storage blocked: the size still applies until the app closes.
  }
}

function step(by: number) {
  const index = TEXT_SIZES.indexOf(current) + by;
  setTextSize(TEXT_SIZES[Math.min(Math.max(index, 0), TEXT_SIZES.length - 1)]);
}

function onKeyDown(event: KeyboardEvent) {
  if (!event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.key === "=" || event.key === "+") step(1);
  else if (event.key === "-") step(-1);
  else if (event.key === "0") setTextSize(100);
  else return;
  event.preventDefault();
}

// Called once at startup, before the first render.
export function initTextSize() {
  apply(loadTextSize());
  window.removeEventListener("keydown", onKeyDown);
  window.addEventListener("keydown", onKeyDown);
}

export function useTextSize(): TextSize {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
