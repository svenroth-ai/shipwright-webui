import { useQuery } from "@tanstack/react-query";

import { getModelTierConfig } from "../lib/modelTierApi";

export function useModelTierConfig(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ["model-tier-config", projectId ?? "__none__"],
    queryFn: () => getModelTierConfig(projectId!),
    enabled: Boolean(projectId),
    staleTime: 5_000,
  });
}
