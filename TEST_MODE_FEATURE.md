# Test Mode Feature - 5 Record Migration

## Overview

Added ability to run test migrations with only 5 records to verify field mappings and configurations before running full migrations.

---

## How to Use

### Step 1: Configure Migration
Navigate through the migration wizard as normal:
1. Select migration type (Account → Company)
2. Map fields
3. View preview

### Step 2: Choose Migration Mode

On the **Preview** screen, you now have TWO buttons:

1. **"Test Migration (5 records)"** - Outlined button
   - Migrates only the first 5 records
   - Perfect for testing field mappings
   - Labeled as TEST in dashboard

2. **"Start Full Migration"** - Primary button
   - Migrates all records (full migration)
   - Production use

### Step 3: Monitor Test Migration

Test migrations are clearly marked:
- 🧪 **TEST** badge next to Run ID
- Shows "(5 records)" in migration type
- Notes field says "TEST: Account to Company migration (5 records only)"

---

## Visual Indicators

### In Dashboard - Migration Runs List:

**Test Migration:**
```
┌─────────────────────────────────────────┐
│ Run ID: abc12345...  [🧪 TEST]   [queued]│
│ Started: 2024-01-02 10:30 AM            │
│ Type: account_to_company (5 records)    │
└─────────────────────────────────────────┘
```

**Full Migration:**
```
┌─────────────────────────────────────────┐
│ Run ID: def67890...           [completed]│
│ Started: 2024-01-02 11:00 AM            │
│ Type: account_to_company                │
└─────────────────────────────────────────┘
```

---

## Worker Behavior

### Test Mode Log Output:

```
📦 Starting migration run: abc-123-def
🧪 TEST MODE: Will migrate only 5 records
Migration type: account_to_company
  fieldCount: 8
  testMode: true

Initializing owner mapper...
Found 50 active Salesforce users
Found 45 HubSpot owners
Created 42 owner mappings

📦 Starting Account to Company migration
🧪 TEST MODE: Will process 5 of 110 total Accounts

Extracted 5 Accounts from Salesforce
Successfully loaded 5 companies to HubSpot
Progress: 5/5 Accounts processed

🧪 TEST MODE: Reached limit of 5 records, stopping
✅ Completed Account to Company migration: 5 records
✅ Migration completed successfully
```

### Full Mode Log Output:

```
📦 Starting migration run: def-456-ghi
Migration type: account_to_company
  fieldCount: 8
  testMode: false

Initializing owner mapper...
...

📦 Starting Account to Company migration
Total Accounts to migrate: 110

Extracted 200 Accounts from Salesforce
Successfully loaded 200 companies to HubSpot
Progress: 200/110 Accounts processed
...
✅ Completed Account to Company migration: 110 records
```

---

## Implementation Details

### Configuration Structure

**Test Migration:**
```json
{
  "migrationType": "account_to_company",
  "fieldMappings": [...],
  "testMode": true,
  "testModeLimit": 5
}
```

**Full Migration:**
```json
{
  "migrationType": "account_to_company",
  "fieldMappings": [...],
  "testMode": false
}
```

### Worker Logic

1. **Batch Size Calculation:**
   ```typescript
   const batchSize = testMode
     ? Math.min(config.migration.batchSize, testModeLimit - processedCount)
     : config.migration.batchSize;
   ```

2. **Record Limit:**
   ```typescript
   const recordsToProcess = testMode
     ? extractResult.records.slice(0, testModeLimit - processedCount)
     : extractResult.records;
   ```

3. **Loop Termination:**
   ```typescript
   if (testMode && processedCount >= testModeLimit) {
     logger.info(`🧪 TEST MODE: Reached limit of ${testModeLimit} records, stopping`);
     break;
   }
   ```

4. **Total Records Tracking:**
   ```typescript
   const recordsToMigrate = testMode
     ? Math.min(testModeLimit, totalRecords)
     : totalRecords;
   ```

---

## Use Cases

### ✅ When to Use Test Mode:

1. **First Time Setup**
   - Testing Salesforce/HubSpot connection
   - Verifying credentials work

2. **New Field Mappings**
   - Testing custom field mappings
   - Verifying data transformation

3. **Owner Mapping Verification**
   - Check if owner emails match
   - Verify owner assignment works

4. **Quick Sanity Check**
   - Before large production migration
   - After code changes

### ❌ When NOT to Use Test Mode:

1. Production migrations
2. When you've already tested and verified
3. When migrating small datasets (<10 records anyway)

---

## Database Impact

### Test Migration:
- Creates migration run record ✓
- Stores 5 ID mappings ✓
- Tracks progress for 5 records ✓
- Owner mappings stored (reusable) ✓
- Minimal HubSpot API usage ✓

### Can Clean Up Test Data:
```sql
-- View test migrations
SELECT id, started_at, notes, status
FROM migration_runs
WHERE notes LIKE 'TEST:%'
ORDER BY started_at DESC;

-- Delete specific test migration (optional)
DELETE FROM migration_runs WHERE id = 'test-run-id';
-- Cascade deletes: progress, mappings, errors, audit logs
```

---

## Files Changed

1. **Dashboard:**
   - `dashboard/app/migrate/page.tsx` - Added testMode parameter to handleConfirmMigration
   - `dashboard/components/MigrationPreview.tsx` - Added two buttons with test mode option
   - `dashboard/app/page.tsx` - Added visual TEST badge and record count

2. **Worker:**
   - `worker/src/services/migrator.ts` - Added test mode logic to limit records

---

## Benefits

✅ **Safe Testing** - No risk of migrating thousands of records accidentally
✅ **Fast Feedback** - See results in seconds, not minutes
✅ **Cost Effective** - Minimal API calls to Salesforce/HubSpot
✅ **Clear Labeling** - Easy to identify test vs production runs
✅ **Full Features** - Owner mapping, field transformation all work the same

---

## Example Workflow

### Testing New Field Mapping:

1. User wants to map custom field `Customer_Tier__c` → `hs_customer_tier`
2. Adds mapping in Field Mapper UI
3. Clicks **"Test Migration (5 records)"**
4. Worker processes 5 records in ~10 seconds
5. User checks HubSpot:
   - ✅ 5 companies created
   - ✅ Custom field mapped correctly
   - ✅ Owners assigned
6. User satisfied, runs full migration
7. Clicks **"Start Full Migration"** for all 5,000 records

---

## Default Limit

Current default: **5 records**

Can be changed in the config:
```typescript
testModeLimit: testMode ? 5 : undefined
```

To change to 10 records:
```typescript
testModeLimit: testMode ? 10 : undefined
```

---

## Future Enhancements

Possible improvements:
- [ ] Allow user to specify test record count (5, 10, 25, 50)
- [ ] Add "Dry Run" mode that doesn't create HubSpot records
- [ ] Show preview of which specific records will be migrated
- [ ] Add "Continue from test" to resume as full migration

---

## Summary

✅ **Feature Complete**
- Two-button interface for test vs full migration
- Worker respects test mode limit
- Clear visual indicators in dashboard
- Comprehensive logging
- Type-safe implementation

**Ready for testing!** Start with a test migration to verify your field mappings before running full migrations.
