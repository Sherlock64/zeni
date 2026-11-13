import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: { alias: { "@": "/src" } },
  // React Query ships "use client" directives, which only matter to server-component bundlers.
  build: { rolldownOptions: { checks: { moduleLevelDirective: false } } },
  // Tauri expects a fixed port and must see Rust errors in the terminal.
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  test: { environment: "jsdom", globals: true },
});
