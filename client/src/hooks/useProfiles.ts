import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';

export interface ProfileSummary {
  name: string;
  label?: string;
  description?: string;
}

export function useProfiles() {
  return useQuery({
    queryKey: ['profiles'],
    queryFn: () => apiFetch<ProfileSummary[]>('/profiles'),
    staleTime: 60_000,
  });
}
