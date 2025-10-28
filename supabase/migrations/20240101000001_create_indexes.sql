-- Indexes for id_mappings (most frequently queried)
CREATE INDEX idx_id_mappings_sf_id ON id_mappings(salesforce_id);
CREATE INDEX idx_id_mappings_hs_id ON id_mappings(hubspot_id);
CREATE INDEX idx_id_mappings_run_id ON id_mappings(run_id);
CREATE INDEX idx_id_mappings_sf_type ON id_mappings(salesforce_type);
CREATE INDEX idx_id_mappings_hs_type ON id_mappings(hubspot_type);

-- Indexes for migration_progress
CREATE INDEX idx_migration_progress_run_id ON migration_progress(run_id);
CREATE INDEX idx_migration_progress_object_type ON migration_progress(object_type);
CREATE INDEX idx_migration_progress_status ON migration_progress(status);

-- Indexes for migration_errors
CREATE INDEX idx_migration_errors_run_id ON migration_errors(run_id);
CREATE INDEX idx_migration_errors_status ON migration_errors(status);
CREATE INDEX idx_migration_errors_sf_id ON migration_errors(salesforce_id);
CREATE INDEX idx_migration_errors_object_type ON migration_errors(object_type);

-- Indexes for audit_log
CREATE INDEX idx_audit_log_run_id ON audit_log(run_id);
CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp DESC);
CREATE INDEX idx_audit_log_action ON audit_log(action);

-- Indexes for migration_runs
CREATE INDEX idx_migration_runs_status ON migration_runs(status);
CREATE INDEX idx_migration_runs_started_at ON migration_runs(started_at DESC);
