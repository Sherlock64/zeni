import { useQuery } from "@tanstack/react-query";
import { tooLarge } from "@/components/build-issues-dialog";
import { buildPreview, listBuilds, ollamaSettings } from "@/lib/commands";
import { BUILD_PREVIEW_KEY, BUILDS_KEY, OLLAMA_SETTINGS_KEY } from "@/lib/query-keys";

/** The active build's name when it is larger than Ollama's window, else null; asks nothing until `enabled`. */
export function useOversizedBuild(enabled: boolean): string | null {
  const builds = useQuery({ queryKey: BUILDS_KEY, queryFn: listBuilds, enabled });
  const settings = useQuery({ queryKey: OLLAMA_SETTINGS_KEY, queryFn: ollamaSettings, enabled });
  const baseModel = settings.data?.baseModel;
  const preview = useQuery({
    queryKey: [...BUILD_PREVIEW_KEY, baseModel],
    queryFn: buildPreview,
    enabled: enabled && Boolean(baseModel),
  });
  const active = builds.data?.find((build) => build.active);
  return active && tooLarge(active, preview.data, Boolean(settings.data?.allowOverWindow)) ? active.name : null;
}
