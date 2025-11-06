# Opportunity Product Dates Migration

## Overview

This migration updates Salesforce Opportunity records with product start and end dates calculated from their associated Line Item Schedules. This is a **Salesforce-only** migration (no HubSpot interaction).

## What It Does

For each Opportunity:

1. **Finds** all OpportunityLineItemSchedule records linked via `psi_Opportunity__c` field
2. **Calculates** the earliest (MIN) and latest (MAX) `ScheduleDate` from these schedules
3. **Updates** the Opportunity fields:
   - `Product_Start_Date__c` = earliest ScheduleDate
   - `Product_End_Date__c` = latest ScheduleDate

## Files Modified

### Database Migration

1. **`supabase/migrations/20240104000000_add_opportunity_product_dates_object_type.sql`**
   - Added `"opportunity_product_dates"` to the `object_type` CHECK constraint
   - This allows the migration_progress table to accept the new object type

### Worker (Backend)

1. **`worker/src/types/index.ts`**
   - Added `"opportunity_product_dates"` to `ObjectType` enum
   - Added `SalesforceOpportunityLineItemSchedule` interface
   - Updated `SalesforceOpportunity` interface with date fields

2. **`worker/src/extractors/salesforce.ts`**
   - `extractLineItemSchedulesByOpportunity()` - Fetches schedules grouped by Opportunity ID
   - `updateOpportunity()` - Updates a single Opportunity
   - `batchUpdateOpportunities()` - Batch updates up to 200 Opportunities at once
   - Added helper method `chunkArray()` for batching

3. **`worker/src/services/migrator.ts`**
   - Added `migrateOpportunityProductDates()` private method
   - Updated `executeMigration()` to handle the new migration type
   - Implements full migration flow with:
     - Progress tracking
     - Batch processing
     - Error handling and logging
     - Test mode support

### Dashboard (Frontend)

1. **`dashboard/app/migrate/page.tsx`**
   - Added `"opportunity_product_dates"` to `MigrationType` enum
   - Added migration option button in the UI
   - Updated `getMigrationTypeName()` helper

2. **`dashboard/components/MigrationPreview.tsx`**
   - Added `"opportunity_product_dates"` to `MigrationType` enum
   - Added preview data fetching logic
   - Added UI sections for:
     - Migration stats display
     - Migration details explanation
     - Sample opportunity records preview

## Migration Flow

```
1. User selects "Opportunity Product Dates (Salesforce Only)" from dashboard
2. Migration is queued with status "queued"
3. Worker picks up the migration
4. For each batch of Opportunities:
   a. Extract Opportunity records (Id, Name, current date fields)
   b. Extract all Line Item Schedules for these Opportunities
   c. Calculate min/max ScheduleDate per Opportunity
   d. Batch update Opportunities in Salesforce
   e. Log any errors
   f. Update progress in database
5. Mark migration as "completed"
```

## Key Features

- **Batch Processing**: Processes Opportunities in configurable batch sizes (default 100)
- **Bulk Query**: Fetches Line Item Schedules for entire batch at once (no N+1 queries)
- **Batch Updates**: Updates up to 200 Opportunities per Salesforce API call
- **Rate Limiting**: Respects Salesforce API limits (10 requests/second)
- **Error Handling**: Logs failed updates without stopping the migration
- **Test Mode**: Can process only 5 records for testing
- **Progress Tracking**: Real-time updates in dashboard
- **Audit Trail**: Complete logging in database

## Data Validation

The migration includes several safety checks:

- Skips Opportunities with no Line Item Schedules
- Filters out invalid dates (NaN values)
- Continues on individual record failures
- Logs all errors with details for troubleshooting

## Testing Instructions

### 0. Apply Database Migration (One-time setup)

```bash
cd /Users/sohrab/work/Salesforce_to_hubspot
supabase db push
```

This adds the new `opportunity_product_dates` object type to the database schema.

### 1. Start the Worker

```bash
cd worker
npm install
npm run dev
```

### 2. Start the Dashboard

```bash
cd dashboard
npm install
npm run dev
```

### 3. Run Test Migration

1. Open http://localhost:3000
2. Click "New Migration"
3. Select "Opportunity Product Dates (Salesforce Only)"
4. Review the preview (shows current values)
5. Click "Test Migration (5 records)"
6. Monitor progress in real-time

### 4. Verify Results in Salesforce

Query updated Opportunities:

```sql
SELECT Id, Name, Product_Start_Date__c, Product_End_Date__c
FROM Opportunity
WHERE Product_Start_Date__c != null
ORDER BY LastModifiedDate DESC
LIMIT 10
```

### 5. Run Full Migration

Once testing is successful:

1. Go to "New Migration"
2. Select "Opportunity Product Dates (Salesforce Only)"
3. Click "Start Full Migration"
4. Monitor progress in dashboard

## Database Schema

The migration uses existing tables:

- **migration_runs**: Tracks the migration execution
- **migration_progress**: Tracks progress (object_type = 'opportunity_product_dates')
- **migration_errors**: Logs any failed Opportunity updates
- **audit_log**: Records migration start/completion

## Configuration

Edit `worker/.env` to adjust:

```bash
BATCH_SIZE=100              # Records per batch
MAX_RETRIES=3               # Retry attempts for failed operations
RATE_LIMIT_DELAY_MS=100     # Delay between API calls
```

## Troubleshooting

### No Line Item Schedules Found

- Verify the `psi_Opportunity__c` field exists on OpportunityLineItemSchedule
- Check that Line Item Schedules are properly linked to Opportunities

### Permission Errors

- Ensure Salesforce credentials have access to:
  - OpportunityLineItemSchedule object (read)
  - Opportunity object (read and update)
  - Fields: Product_Start_Date**c, Product_End_Date**c

### API Rate Limits

- Reduce BATCH_SIZE in .env
- Increase RATE_LIMIT_DELAY_MS

## Example Log Output

```
📦 Starting Opportunity Product Dates migration
🧪 TEST MODE: Will process 5 of 1234 total Opportunities
Extracted 5 Opportunities from Salesforce
Found Line Item Schedules for 4 out of 5 opportunities
Updating 4 opportunities with product dates
Batch update completed { successful: 4, failed: 0 }
Progress: 5/5 Opportunities processed (4 updated, 0 failed)
✅ Completed Opportunity Product Dates migration: 5 opportunities processed (4 updated, 0 failed)
```

## Notes

- This migration does NOT create or update HubSpot records
- Opportunities without Line Item Schedules are skipped (not counted as errors)
- Existing Product_Start_Date**c and Product_End_Date**c values will be overwritten
- The migration can be run multiple times safely (idempotent)
