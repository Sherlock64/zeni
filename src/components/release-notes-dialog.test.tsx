import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PendingReleaseNotes, ReleaseNotesButton } from "@/components/release-notes-dialog";
import { acknowledgeReleaseNotes, releaseNotes } from "@/lib/commands";
import type { ReleaseNotes } from "@/types/bindings/ReleaseNotes";

vi.mock("@/lib/commands", () => ({ releaseNotes: vi.fn(), acknowledgeReleaseNotes: vi.fn() }));

const notes: ReleaseNotes = {
  pending: [{ version: "7.1.0", lines: ["Monthly spending.", "- Totals per month.", "- Export a month.", "Thanks for testing."] }],
  all: [
    { version: "7.1.0", lines: ["- Totals per month."] },
    { version: "7.0.0", lines: ["- Update notice."] },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(releaseNotes).mockResolvedValue(notes);
  vi.mocked(acknowledgeReleaseNotes).mockResolvedValue(null);
});

function renderWith(element: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <main>
        <h1 tabIndex={-1}>Transactions</h1>
        {element}
      </main>
    </QueryClientProvider>,
  );
  return client;
}

test("shows pending sections, with list items and paragraphs", async () => {
  renderWith(<PendingReleaseNotes />);
  const dialog = await screen.findByRole("dialog", { name: "What's new in Zeni" });
  const section = within(dialog).getByRole("heading", { level: 3, name: "7.1.0" }).closest("section")!;
  expect([...section.children].map((child) => [child.tagName, child.textContent])).toEqual([
    ["H3", "7.1.0"],
    ["P", "Monthly spending."],
    ["UL", "Totals per month.Export a month."],
    ["P", "Thanks for testing."],
  ]);
  expect(within(dialog).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Totals per month.", "Export a month."]);
});

test("acknowledges once on close and focuses the page heading", async () => {
  const client = renderWith(<PendingReleaseNotes />);
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(client.getQueryData<ReleaseNotes>(["release_notes"])?.pending).toEqual([]));
  expect(acknowledgeReleaseNotes).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Transactions" }));
});

test("stays closed after a failed acknowledge", async () => {
  vi.mocked(acknowledgeReleaseNotes).mockRejectedValue({ kind: "Database", message: "database is locked" });
  renderWith(<PendingReleaseNotes />);
  fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(acknowledgeReleaseNotes).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("opens nothing when no notes are pending", async () => {
  vi.mocked(releaseNotes).mockResolvedValue({ ...notes, pending: [] });
  const client = renderWith(<PendingReleaseNotes />);
  await waitFor(() => expect(client.getQueryState(["release_notes"])?.status).toBe("success"));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("the Release notes button shows every section and never acknowledges", async () => {
  renderWith(<ReleaseNotesButton />);
  fireEvent.click(screen.getByRole("button", { name: "Release notes" }));
  const dialog = await screen.findByRole("dialog", { name: "What's new in Zeni" });
  expect((await within(dialog).findAllByRole("heading", { level: 3 })).map((h) => h.textContent)).toEqual(["7.1.0", "7.0.0"]);
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(acknowledgeReleaseNotes).not.toHaveBeenCalled();
});

test("the Release notes button shows loading, empty and error states", async () => {
  vi.mocked(releaseNotes).mockReturnValue(new Promise(() => {}));
  renderWith(<ReleaseNotesButton />);
  fireEvent.click(screen.getByRole("button", { name: "Release notes" }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog.querySelector("[data-slot=skeleton]")).not.toBeNull();
  cleanup();

  vi.mocked(releaseNotes).mockResolvedValue({ pending: [], all: [] });
  renderWith(<ReleaseNotesButton />);
  fireEvent.click(screen.getByRole("button", { name: "Release notes" }));
  expect(await screen.findByText("No release notes yet.")).toBeTruthy();
  cleanup();

  vi.mocked(releaseNotes).mockRejectedValue({ kind: "Invoke", message: "not running in Tauri" });
  renderWith(<ReleaseNotesButton />);
  fireEvent.click(screen.getByRole("button", { name: "Release notes" }));
  expect(within(await screen.findByRole("alert")).getByText("Couldn't load the release notes")).toBeTruthy();
});
