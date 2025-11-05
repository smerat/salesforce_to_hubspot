-- Owner mappings table for SF User to HS Owner mapping
CREATE TABLE owner_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES migration_runs(id) ON DELETE CASCADE,
  sf_user_id TEXT NOT NULL,
  sf_user_email TEXT,
  sf_user_name TEXT,
  hs_owner_id TEXT NOT NULL,
  hs_owner_email TEXT,
  hs_owner_name TEXT,
  match_method TEXT CHECK (match_method IN ('email', 'name', 'manual')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sf_user_id, run_id)
);

-- Index for fast lookups
CREATE INDEX idx_owner_mappings_sf_user_id ON owner_mappings(sf_user_id);
CREATE INDEX idx_owner_mappings_run_id ON owner_mappings(run_id);
CREATE INDEX idx_owner_mappings_hs_owner_id ON owner_mappings(hs_owner_id);

-- Trigger for updated_at
CREATE TRIGGER update_owner_mappings_updated_at BEFORE UPDATE ON owner_mappings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE owner_mappings IS 'Maps Salesforce User IDs to HubSpot Owner IDs for owner assignment during migration';
COMMENT ON COLUMN owner_mappings.match_method IS 'Method used to match SF user to HS owner: email (matched by email), name (matched by name), manual (manually set)';
