import { useQuery } from "@tanstack/react-query";
import { startupStatus } from "@/lib/commands";
import { STARTUP_STATUS_KEY } from "@/lib/query-keys";

// Shared by the shell's gate and the startup problem screen. Only Retry or Continue changes it, so never refetch on its own.
export const useStartupStatus = () =>
  useQuery({ queryKey: STARTUP_STATUS_KEY, queryFn: startupStatus, staleTime: Infinity, refetchOnWindowFocus: false });
