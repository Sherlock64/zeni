import tailwindcss from "@tailwindcss/vite";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: { alias: { "@": "/src" } },
  // React Query ships "use client" directives, which only matter to server-component bundlers.
  build: { rolldownOptions: { checks: { moduleLevelDirective: false } } },
  // Tauri expects a fixed port and must see Rust errors in the terminal.
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  // Agent worktrees under .claude/ hold stale copies of the tests.
  test: { environment: "jsdom", globals: true, exclude: [...configDefaults.exclude, ".claude/**"] },
});
