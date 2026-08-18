GET /api/external/org/leads/:leadId/last-run reports a lead's last-run staleness (fresh/stale/unknown-cadence) computed server-side from that lead's own cron cadence, never a hardcoded interval.
