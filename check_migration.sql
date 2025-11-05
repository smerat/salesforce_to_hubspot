SELECT 
  id,
  status,
  started_at,
  config_snapshot->>'testMode' as test_mode,
  notes
FROM migration_runs 
ORDER BY started_at DESC 
LIMIT 3;
