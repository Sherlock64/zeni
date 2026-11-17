import { render, screen } from "@testing-library/react";
import { CommandErrorAlert } from "@/components/command-error-alert";

test.each([
  ["Ollama isn't running on port 11434. Start it with `ollama serve`.", "Check that Ollama is running, then try again."],
  ["Ollama stopped responding after 12 rows.", "Check that Ollama is running, then try again."],
  ["Pick a model in Settings first.", "Pick a base model in Settings → Ollama."],
  ["Ollama said: model not found", "Fix the problem Ollama reports, then try again."],
])("picks the Ollama next step by message: %s", (message, nextStep) => {
  render(<CommandErrorAlert title="Couldn't start categorizing" error={{ kind: "Ollama", message }} />);
  expect(screen.getByText(nextStep)).toBeTruthy();
});

test("shows the Busy next step", () => {
  render(<CommandErrorAlert title="Couldn't start categorizing" error={{ kind: "Busy", message: "Categorize now is running." }} />);
  expect(screen.getByText("Wait for it to finish, or cancel it from the banner.")).toBeTruthy();
});

test("shows a backtick-quoted command as code", () => {
  render(<CommandErrorAlert title="Ollama" error={{ kind: "Ollama", message: "Start it with `ollama serve`." }} />);
  expect(screen.getByText("ollama serve").tagName).toBe("CODE");
  expect(screen.queryByText(/`/)).toBeNull();
});
