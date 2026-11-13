import { useQuery } from "@tanstack/react-query";
import { appInfo } from "@/lib/commands";

// One query key, so the shell's startup check and the Settings page share a single fetch.
export const useAppInfo = () => useQuery({ queryKey: ["app_info"], queryFn: appInfo });
