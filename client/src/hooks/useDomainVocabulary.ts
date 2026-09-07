/*
 * useDomainVocabulary — the ONE shared domain-vocabulary read
 * (iterate-2026-09-07-leadwright-setup-wizard, W14). Consumed by BOTH the
 * lead-setup wizard's domain step AND `LeadwrightFields.tsx`'s converted
 * domain select — a single source of truth is the whole point of the fix
 * (two independently-fetched lists would just reintroduce the drift).
 */
import { useQuery } from "@tanstack/react-query";

import { fetchDomains } from "../lib/leadSetupWizardApi";

export const DOMAIN_VOCABULARY_QUERY_KEY = ["org", "domains"] as const;

export function useDomainVocabulary() {
  return useQuery({
    queryKey: DOMAIN_VOCABULARY_QUERY_KEY,
    queryFn: fetchDomains,
    // A card created (or a lead added) elsewhere in the same session should
    // show up on a re-open without a hard refresh, but this backs a
    // frequently-opened modal (NewIssueModal) too — a few minutes keeps it
    // off the hot path (external-review finding, GLM).
    staleTime: 3 * 60 * 1000,
    retry: false,
  });
}
