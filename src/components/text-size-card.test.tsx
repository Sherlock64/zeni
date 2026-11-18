import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { TextSizeCard } from "@/components/text-size-card";
import { initTextSize } from "@/hooks/use-text-size";

// jsdom lacks ResizeObserver, which the radio group uses.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

beforeEach(() => {
  localStorage.clear();
  initTextSize();
});

it("shows the sizes with 100% chosen by default and names the shortcuts", () => {
  render(<TextSizeCard />);
  screen.getByRole("radiogroup", { name: "Text size" });
  expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("value"))).toEqual(["90", "100", "115", "130", "150"]);
  expect(screen.getByRole("radio", { name: "100% (default)" }).getAttribute("aria-checked")).toBe("true");
  screen.getByText(/Ctrl\+= or Ctrl\+\+ makes text bigger, Ctrl\+- smaller, Ctrl\+0 resets it/);
});

it("applies and saves the chosen size", () => {
  render(<TextSizeCard />);
  fireEvent.click(screen.getByRole("radio", { name: "130%" }));
  expect(document.documentElement.style.fontSize).toBe("130%");
  expect(localStorage.getItem("zeni.textSize")).toBe("130");
  expect(screen.getByRole("radio", { name: "130%" }).getAttribute("aria-checked")).toBe("true");
});

it("follows a size changed by a shortcut", () => {
  render(<TextSizeCard />);
  act(() => {
    fireEvent.keyDown(window, { key: "-", ctrlKey: true });
  });
  expect(screen.getByRole("radio", { name: "90%" }).getAttribute("aria-checked")).toBe("true");
});
