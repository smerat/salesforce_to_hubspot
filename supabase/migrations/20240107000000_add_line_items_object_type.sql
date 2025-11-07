-- Add line_items to the object_type check constraint

ALTER TABLE migration_progress
DROP CONSTRAINT IF EXISTS migration_progress_object_type_check;

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
  'line_items'
));
