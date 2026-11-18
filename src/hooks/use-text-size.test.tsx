import { fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initTextSize } from "@/hooks/use-text-size";

const root = document.documentElement;

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  root.style.fontSize = "";
});

describe("initTextSize", () => {
  it("applies the saved size at startup", () => {
    localStorage.setItem("zeni.textSize", "130");
    initTextSize();
    expect(root.style.fontSize).toBe("130%");
  });

  it("falls back to 100% for a missing or unknown value", () => {
    initTextSize();
    expect(root.style.fontSize).toBe("");
    localStorage.setItem("zeni.textSize", "999");
    initTextSize();
    expect(root.style.fontSize).toBe("");
  });

  it("falls back to 100% when storage throws", () => {
    localStorage.setItem("zeni.textSize", "150");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    initTextSize();
    expect(root.style.fontSize).toBe("");
  });

  it("steps through the sizes with the shortcuts and saves each one", () => {
    initTextSize();
    fireEvent.keyDown(window, { key: "=", ctrlKey: true });
    expect(root.style.fontSize).toBe("115%");
    fireEvent.keyDown(window, { key: "+", ctrlKey: true, shiftKey: true });
    expect(root.style.fontSize).toBe("130%");
    expect(localStorage.getItem("zeni.textSize")).toBe("130");
    fireEvent.keyDown(window, { key: "-", ctrlKey: true });
    expect(root.style.fontSize).toBe("115%");
    fireEvent.keyDown(window, { key: "0", ctrlKey: true });
    expect(root.style.fontSize).toBe("");
    expect(localStorage.getItem("zeni.textSize")).toBe("100");
  });

  it("stops at the smallest and largest sizes", () => {
    initTextSize();
    for (let i = 0; i < 6; i++) fireEvent.keyDown(window, { key: "-", ctrlKey: true });
    expect(root.style.fontSize).toBe("90%");
    for (let i = 0; i < 6; i++) fireEvent.keyDown(window, { key: "=", ctrlKey: true });
    expect(root.style.fontSize).toBe("150%");
  });

  it("ignores the keys without Ctrl, and registers the listener only once", () => {
    initTextSize();
    initTextSize();
    fireEvent.keyDown(window, { key: "=" });
    expect(root.style.fontSize).toBe("");
    fireEvent.keyDown(window, { key: "=", ctrlKey: true });
    expect(root.style.fontSize).toBe("115%");
  });

  it("still applies a size when saving throws", () => {
    initTextSize();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    fireEvent.keyDown(window, { key: "=", ctrlKey: true });
    expect(root.style.fontSize).toBe("115%");
  });
});
