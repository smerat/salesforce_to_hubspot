-- Migration runs tracking
CREATE TABLE migration_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'paused')),
  config_snapshot JSONB,
  notes TEXT,
  created_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Progress tracking per object type
CREATE TABLE migration_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES migration_runs(id) ON DELETE CASCADE,
  object_type TEXT NOT NULL CHECK (object_type IN ('contacts', 'companies', 'deals', 'activities', 'notes')),
  total_records INTEGER,
  processed_records INTEGER DEFAULT 0,
  failed_records INTEGER DEFAULT 0,
  skipped_records INTEGER DEFAULT 0,
  last_sf_id_processed TEXT,
  last_sf_modified_date TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(run_id, object_type)
);

-- ID mappings for associations
CREATE TABLE id_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES migration_runs(id) ON DELETE CASCADE,
  salesforce_id TEXT NOT NULL,
  salesforce_type TEXT NOT NULL,
  hubspot_id TEXT NOT NULL,
  hubspot_type TEXT NOT NULL,
  migrated_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB,
  UNIQUE(salesforce_id, salesforce_type)
);

-- Error tracking
CREATE TABLE migration_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES migration_runs(id) ON DELETE CASCADE,
  salesforce_id TEXT,
  salesforce_type TEXT,
  object_type TEXT NOT NULL,
  error_message TEXT,
  error_details JSONB,
  retry_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending_retry' CHECK (status IN ('pending_retry', 'failed', 'resolved', 'skipped')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT
);

-- Audit log
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES migration_runs(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  object_type TEXT,
  record_count INTEGER,
  metadata JSONB,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_migration_runs_updated_at BEFORE UPDATE ON migration_runs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_migration_progress_updated_at BEFORE UPDATE ON migration_progress
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
