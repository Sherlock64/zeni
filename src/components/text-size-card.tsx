import { useId } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { setTextSize, TEXT_SIZES, useTextSize } from "@/hooks/use-text-size";
import type { TextSize } from "@/types/ui";

export function TextSizeCard() {
  const id = useId();
  const size = useTextSize();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 id={`${id}-title`}>Text size</h2>
        </CardTitle>
        <CardDescription id={`${id}-description`}>
          Saved on this computer. Shortcuts: Ctrl+= or Ctrl++ makes text bigger, Ctrl+- smaller, Ctrl+0 resets it to
          100%.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RadioGroup
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-description`}
          value={String(size)}
          onValueChange={(value) => setTextSize(Number(value) as TextSize)}
          className="flex flex-wrap gap-x-6 gap-y-2"
        >
          {TEXT_SIZES.map((choice) => (
            <div key={choice} className="flex items-center gap-2">
              <RadioGroupItem id={`${id}-${choice}`} value={String(choice)} className="border-muted-foreground" />
              <Label htmlFor={`${id}-${choice}`} className="font-normal">
                {choice}%{choice === 100 && " (default)"}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </CardContent>
    </Card>
  );
}
