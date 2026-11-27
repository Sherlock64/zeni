// verify-zeni driver: builds the debug app, gives it a throwaway data folder, completes setup,
// imports the seed file through the real picker, then screenshots and times every page at two sizes.
// Usage: node scripts/verify/run.ts <ticket> [--no-build]      (run from the repo root; see .claude/skills/verify-zeni)
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { remote } from "webdriverio";
import type { VerifyReport, VerifySize } from "../../src/types/verify.ts";

// Test-only credentials for a throwaway dev database; never a real password.
const PASSWORD = "zeni-dev-verify-pw";
const SIZES: VerifySize[] = [{ width: 800, height: 600 }, { width: 1920, height: 1080 }];
const PAGES = ["Transactions", "Review", "Nicknames", "Categories", "Accounts", "Settings"];

const ticket = process.argv[2];
if (!ticket || !/^\d+$/.test(ticket)) throw new Error("usage: node scripts/verify/run.ts <ticket> [--no-build]");
const out = resolve("snapshots", `t${ticket}`);
mkdirSync(out, { recursive: true });
const binary = resolve("src-tauri/target/debug/zeni");
const dataHome = mkdtempSync(join(tmpdir(), "zeni-verify-"));
const realDb = join(homedir(), ".local/share/com.sherlock64.zeni/zeni.db");
const fingerprint = () => (existsSync(realDb) ? createHash("sha256").update(readFileSync(realDb)).digest("hex") : "absent");

const run = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
};

if (!process.argv.includes("--no-build")) run("pnpm", ["tauri", "build", "--debug", "--no-bundle"]);
const pre = spawnSync("scripts/verify/preflight.sh", [dataHome, binary], { stdio: "inherit" });
if (pre.status !== 0) process.exit(1);
const seed = resolve(out, "seed-dev.ofx");
run("scripts/seed-dev.sh", [seed]);

const before = fingerprint();
// GDK_BACKEND=x11 puts the app and its file picker under XWayland, where xdotool can reach them.
const env = { ...process.env, XDG_DATA_HOME: dataHome, GDK_BACKEND: "x11" };
const driver = spawn("tauri-driver", ["--native-driver", "/usr/bin/WebKitWebDriver"], { env, stdio: "inherit" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
await sleep(1500);

const report: VerifyReport = { seedRows: 0, imported: "", timings: [], screenshots: [] };
const browser = await remote({
  hostname: "127.0.0.1",
  port: 4444,
  logLevel: "warn",
  capabilities: { "tauri:options": { application: binary } } as WebdriverIO.Capabilities,
});
try {
  await browser.setWindowSize(800, 600);
  const fill = async (name: string, value: string) => (await browser.$(`input[name="${name}"]`)).setValue(value);
  await (await browser.$("h1=Set up Zeni")).waitForExist({ timeout: 30000 });
  await fill("masterPassword", PASSWORD);
  await fill("masterPasswordConfirm", PASSWORD);
  await fill("owner", "Verifier");
  await fill("bankName", "Example Community Bank");
  await fill("accountNumber", "0000000000");
  await fill("routingNumber", "000000000");
  await (await browser.$("button=Set up Zeni")).click();
  // Argon2id in a debug build is slow.
  const saved = await browser.$("[role=checkbox]");
  await saved.waitForExist({ timeout: 120000 });
  await saved.click();
  await (await browser.$("button=Continue")).click();

  await (await browser.$("a=Transactions")).click();
  await (await browser.$("button=Import file")).click();
  await sleep(2000); // the native picker opens; Ctrl+L opens its location field
  for (const args of [["key", "ctrl+l"], ["type", "--delay", "20", seed], ["key", "Return"]]) {
    spawnSync("xdotool", args, { env });
    await sleep(500);
  }
  const statusText = () => browser.execute(() => [...document.querySelectorAll("[role=status]")].map((e) => e.textContent).join(" | "));
  await browser.waitUntil(async () => (await statusText()).includes("transactions added"), { timeout: 60000 });
  report.imported = await statusText();
  report.seedRows = readFileSync(seed, "utf8").split("<STMTTRN>").length - 1;

  for (const size of SIZES) {
    await browser.setWindowSize(size.width, size.height);
    const label = `${size.width}x${size.height}`;
    for (const page of PAGES) {
      const started = Date.now();
      await (await browser.$(`a=${page}`)).click();
      await (await browser.$("main h1")).waitForExist({ timeout: 30000 });
      await browser.waitUntil(async () => (await browser.execute(() => document.querySelectorAll("[role=progressbar], [data-slot=skeleton]").length)) === 0, { timeout: 30000 });
      report.timings.push({ page, size: label, ms: Date.now() - started });
      const file = join(out, `${page.toLowerCase()}-${label}.png`);
      await browser.saveScreenshot(file);
      report.screenshots.push(file);
    }
  }
} catch (error) {
  await browser.saveScreenshot(join(out, "failure.png")).catch(() => {});
  throw error;
} finally {
  writeFileSync(join(out, "verify-report.json"), JSON.stringify(report, null, 2));
  await browser.deleteSession().catch(() => {});
  driver.kill();
}
const after = fingerprint();
if (before !== after) throw new Error("the real database changed during the run");
console.log(`real database unchanged (${before.slice(0, 12)}); report in ${out}/verify-report.json`);
console.log(report.imported);
