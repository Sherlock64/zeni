import { CopyIcon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { RecoveryCodesProps } from "@/types/ui";

export function RecoveryCodes({ codes, onContinue }: RecoveryCodesProps) {
  const [saved, setSaved] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [showSavedHint, setShowSavedHint] = useState(false);
  const checkboxId = useId();
  const hintId = useId();

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopyStatus("Copied to the clipboard.");
    } catch {
      setCopyStatus("Couldn't copy. Select the codes and copy them by hand.");
    }
  }

  function continueClicked() {
    if (!saved) return setShowSavedHint(true);
    onContinue();
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Each code works once. Store them somewhere safe; they're shown only now.
      </p>
      <ul aria-label="Recovery codes" className="grid grid-cols-1 gap-2 rounded-lg border bg-muted/30 p-4 font-mono text-sm sm:grid-cols-2">
        {codes.map((code) => (
          <li key={code} className="tracking-wider select-all">
            {code}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={copy}>
          <CopyIcon aria-hidden="true" />
          Copy codes
        </Button>
        {/* Always mounted, so screen readers announce each change to its text. */}
        <p role="status" className="text-sm text-muted-foreground">
          {copyStatus}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id={checkboxId}
          checked={saved}
          onCheckedChange={(checked) => {
            setSaved(checked === true);
            setShowSavedHint(false);
          }}
          aria-describedby={showSavedHint ? hintId : undefined}
          aria-invalid={showSavedHint || undefined}
        />
        <Label htmlFor={checkboxId}>I've saved these codes</Label>
      </div>
      {showSavedHint && (
        <p id={hintId} className="text-sm text-destructive">
          Save the codes and tick the box first.
        </p>
      )}
      <div>
        <Button onClick={continueClicked} aria-disabled={!saved}>
          Continue
        </Button>
      </div>
    </div>
  );
}
