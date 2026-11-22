import { useQuery } from "@tanstack/react-query";
import { appInfo } from "@/lib/commands";
import { APP_INFO_KEY } from "@/lib/query-keys";

// One query key, so the shell's startup check and the Settings page share a single fetch.
export const useAppInfo = () => useQuery({ queryKey: APP_INFO_KEY, queryFn: appInfo });
