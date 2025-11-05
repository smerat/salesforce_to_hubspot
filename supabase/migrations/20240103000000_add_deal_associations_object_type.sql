-- Add 'deal_associations' to the object_type constraint in migration_progress
ALTER TABLE migration_progress
DROP CONSTRAINT IF EXISTS migration_progress_object_type_check;

ALTER TABLE migration_progress
ADD CONSTRAINT migration_progress_object_type_check
CHECK (object_type IN ('contacts', 'companies', 'deals', 'activities', 'notes', 'deal_associations'));
