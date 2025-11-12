-- Replace cleanup_engagements with separate cleanup types

-- Drop the old constraint first
ALTER TABLE migration_progress
DROP CONSTRAINT IF EXISTS migration_progress_object_type_check;

-- Update any existing cleanup_engagements rows to cleanup_tasks
UPDATE migration_progress
SET object_type = 'cleanup_tasks'
WHERE object_type = 'cleanup_engagements';

-- Add the new constraint with separate cleanup types
ALTER TABLE migration_progress
ADD CONSTRAINT migration_progress_object_type_check
CHECK (object_type IN (
  'contacts',
  'companies',
  'deals',
  'activities',
  'notes',
  'deal_associations',
  'opportunity_product_dates',
  'sync_deal_contract_dates',
  'opportunity_line_item_dates',
  'line_items',
  'cleanup_tasks',
  'cleanup_meetings',
  'cleanup_line_items'
));
