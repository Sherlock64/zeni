import { type QueryClient, useQuery } from "@tanstack/react-query";
import { jobStatus } from "@/lib/commands";
import { JOB_STATUS_KEY } from "@/lib/query-keys";

// There are no backend events: poll while a job runs, otherwise fetch only on mount or when a mutation invalidates it.
export const useJobStatus = () =>
  useQuery({
    queryKey: JOB_STATUS_KEY,
    queryFn: jobStatus,
    refetchInterval: (query) => (query.state.data?.running ? 500 : false),
    refetchOnWindowFocus: false,
  });

// Call after starting, cancelling or clearing a job so every banner, action and card sees it.
export const invalidateJobStatus = (client: QueryClient) => client.invalidateQueries({ queryKey: JOB_STATUS_KEY });
