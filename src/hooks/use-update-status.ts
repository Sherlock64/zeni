import { useQuery } from "@tanstack/react-query";
import { updateStatus } from "@/lib/commands";
import { UPDATE_STATUS_KEY } from "@/lib/query-keys";

// Shared by the update banner and the About card; polls only while a check is in flight.
export const useUpdateStatus = () =>
  useQuery({
    queryKey: UPDATE_STATUS_KEY,
    queryFn: updateStatus,
    refetchInterval: (query) => (query.state.data?.checking ? 2000 : false),
  });
