import { useMutation, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CircleArrowUpIcon } from "lucide-react";
import { CommandErrorAlert } from "@/components/command-error-alert";
import { Button } from "@/components/ui/button";
import { useUpdateStatus } from "@/hooks/use-update-status";
import { dismissUpdate } from "@/lib/commands";
import { UPDATE_STATUS_KEY } from "@/lib/query-keys";

// In the unlocked app only. A failed status just hides the banner; the About card shows the error.
export function UpdateBanner() {
  const queryClient = useQueryClient();
  const banner = useUpdateStatus().data?.banner;
  const dismiss = useMutation({
    mutationFn: dismissUpdate,
    onSuccess: (status) => {
      queryClient.setQueryData(UPDATE_STATUS_KEY, status);
      // The banner and its buttons are gone, so don't leave focus on nothing.
      document.querySelector<HTMLElement>("main h1")?.focus();
    },
  });

  return (
    <>
      {/* Always mounted, so screen readers hear the banner appear even though focus lands after it. */}
      <p role="status" className="sr-only">
        {banner ? `Zeni ${banner.version} is available` : ""}
      </p>
      {banner && (
        <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-3 px-8 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <CircleArrowUpIcon aria-hidden="true" className="size-4 text-primary" />
              Zeni {banner.version} is available
            </p>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" onClick={() => openUrl(banner.url)}>
                Download Zeni {banner.version}
                {" "}<span className="sr-only">(opens in your browser)</span>
              </Button>
              <Button variant="outline" size="sm" aria-disabled={dismiss.isPending} onClick={() => !dismiss.isPending && dismiss.mutate()}>
                Dismiss
              </Button>
            </div>
          </div>
          {dismiss.isError && <CommandErrorAlert title="Couldn't dismiss the update" error={dismiss.error} />}
        </div>
      )}
    </>
  );
}
