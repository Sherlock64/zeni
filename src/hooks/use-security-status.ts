import { useQuery } from "@tanstack/react-query";
import { securityStatus } from "@/lib/commands";
import { SECURITY_STATUS_KEY } from "@/lib/query-keys";

// Shared by the shell's gate and Settings (recovery codes left, keyring state).
// Only explicit invalidates refresh it: a focus refetch would swap setup's one-time recovery codes for the app.
export const useSecurityStatus = () =>
  useQuery({ queryKey: SECURITY_STATUS_KEY, queryFn: securityStatus, staleTime: Infinity, refetchOnWindowFocus: false });
