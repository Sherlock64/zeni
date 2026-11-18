import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ollamaSettings, setAutoCategorize } from "@/lib/commands";
import { OLLAMA_SETTINGS_KEY } from "@/lib/query-keys";

export function AutoCategorizeSwitch() {
  const queryClient = useQueryClient();
  const id = useId();
  const settings = useQuery({ queryKey: OLLAMA_SETTINGS_KEY, queryFn: ollamaSettings });
  const save = useMutation({
    mutationFn: setAutoCategorize,
    onSuccess: (saved) => queryClient.setQueryData(OLLAMA_SETTINGS_KEY, saved),
  });

  // The Ollama card shows the settings' loading and error states.
  if (!settings.data) return null;
  const checked = save.isPending ? save.variables.enabled : settings.data.autoCategorize;

  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex items-center gap-3">
        <Switch
          id={id}
          checked={checked}
          aria-disabled={save.isPending}
          onCheckedChange={(enabled) => !save.isPending && save.mutate({ enabled })}
        />
        <Label htmlFor={id}>Categorize new rows after each import</Label>
      </div>
      {save.isError && <CommandErrorAlert title="Couldn't save the setting" error={save.error} />}
    </div>
  );
}
