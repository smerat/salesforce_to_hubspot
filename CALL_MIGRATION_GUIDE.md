# Call Migration from Excel to HubSpot - Guide

This guide walks you through migrating Salesforce Call/Task activities from Excel files to HubSpot.

## Overview

The call migration system:

- Reads 3 Excel files containing call data with associations to Contacts, Accounts, and Opportunities
- Groups calls by Activity ID (handles same call associated with multiple objects)
- Bulk lookups HubSpot object IDs using Salesforce IDs
- Creates calls in HubSpot with proper associations in batch (100 at a time)
- Tracks progress in real-time via the dashboard

## Excel Files Structure

Place your Excel files in `data/call-data/`:

1. **Calls - Contacts-Migration List.xlsx**
   - Associates calls with Salesforce Contacts
   - Uses HubSpot property: `salesforcecontactid`
   - Association Type ID: 194

2. **Calls - Accounts- Migration List.xlsx**
   - Associates calls with Salesforce Accounts (Companies)
   - Uses HubSpot property: `salesforceaccountid`
   - Association Type ID: 182

3. **Calls - Opportunities-Migration List.xlsx**
   - Associates calls with Salesforce Opportunities (Deals)
   - Uses HubSpot property: `hs_salesforceopportunityid`
   - Association Type ID: 206

## Migration Process

### Step 1: Prepare Excel Files

Ensure your Excel files are in the correct location:

```bash
data/call-data/
├── Calls - Contacts-Migration List.xlsx
├── Calls - Accounts- Migration List.xlsx
└── Calls - Opportunities-Migration List.xlsx
```

### Step 2: Create Migration Run (Test Mode First!)

**Important**: Always test with a small subset first!

**Option A: Using the Dashboard (Recommended)**

```bash
cd dashboard
npm run dev
# Visit http://localhost:3000/migrate
```

1. Click on "📞 Calls from Excel Files (Excel → HubSpot)"
2. Review the migration details
3. Click "Start Test Migration (5 records)" for testing
4. Or click "Start Full Migration" when ready

**Option B: Using Test Script**

```bash
cd worker
npx tsx test-call-migration.ts
```

This creates a migration run in **TEST MODE** that will process only 10 unique calls.

### Step 3: Start the Worker

```bash
cd worker
npm run dev
```

The worker will:

- Poll the database for queued migrations
- Find the call migration run
- Read all Excel files (~5,455 rows total)
- Group by Activity ID (~2,800 unique calls)
- Process only 10 calls in test mode
- Create calls in HubSpot with associations

### Step 4: Monitor in Dashboard

Open another terminal:

```bash
cd dashboard
npm run dev
```

Visit http://localhost:3000 to see:

- Real-time progress
- Success/failure counts
- Error details if any

### Step 5: Review Test Results

Check the dashboard for:

- ✅ Successful call creations
- ❌ Any errors (missing objects, failed associations)
- Progress metrics

### Step 6: Run Full Migration

Once test mode succeeds, create a full migration:

**Option A: Using the Dashboard**

- Go to http://localhost:3000
- Click "New Migration"
- Select migration type: `call_migration_from_excel`
- Disable test mode (or set limit higher)

**Option B: Manual Database Insert**

```bash
cd worker
npx tsx -e "
import database from './src/services/database';
await database.createMigrationRun('queued', {
  migrationType: 'call_migration_from_excel',
  testMode: false
}, 'Full call migration from Excel');
await database.close();
"
```

## How It Works

### 1. Read Excel Files

- Parses all 3 Excel files
- Extracts: Activity ID, Salesforce IDs, owner, title, timestamp, status, body
- Total records: ~5,455 rows

### 2. Group by Activity ID

- Same Activity ID from different files = ONE call with multiple associations
- Example: Activity "00TON123" appears in Contacts file AND Accounts file
  - Result: 1 call created with 2 associations (Contact + Company)

### 3. Bulk Lookup HubSpot IDs

- Collects all unique Salesforce IDs (Contacts, Accounts, Opportunities)
- Searches HubSpot in bulk using `IN` operator
- Builds mapping: Salesforce ID → HubSpot ID

### 4. Map Owners

- Searches HubSpot owners by name
- Falls back to **Sean Merat** if owner not found

### 5. Build Calls with Associations

For each unique Activity ID:

```json
{
  "properties": {
    "hs_timestamp": 1714636440000,
    "hs_call_title": "Call",
    "hs_call_body": "Meeting notes...",
    "hs_call_status": "COMPLETED",
    "hubspot_owner_id": "12345"
  },
  "associations": [
    {
      "to": { "id": "contact-hs-id" },
      "types": [
        { "associationCategory": "HUBSPOT_DEFINED", "associationTypeId": 194 }
      ]
    },
    {
      "to": { "id": "company-hs-id" },
      "types": [
        { "associationCategory": "HUBSPOT_DEFINED", "associationTypeId": 182 }
      ]
    }
  ]
}
```

### 6. Batch Create in HubSpot

- Creates 100 calls per batch
- Each call includes all associations
- Total batches: ~28 (for 2,800 calls)

## Expected Results

### Test Mode (10 calls)

- Duration: ~30 seconds
- Calls created: 10
- Associations: Varies (1-3 per call)

### Full Migration (~2,800 calls)

- Duration: ~15-20 minutes
- Calls created: ~2,800
- Total associations: ~5,455
- Rate: ~150-200 calls/minute

## Error Handling

### Common Errors

1. **HubSpot object not found**
   - Error: "contact/company/deal not found in HubSpot for Salesforce ID: xxx"
   - Cause: Associated object hasn't been migrated to HubSpot yet
   - Solution: Migrate Contacts/Companies/Deals first

2. **Owner not found**
   - Warning: "Owner not found, using fallback"
   - Cause: Owner name doesn't match HubSpot owners
   - Fallback: Uses Sean Merat's owner ID

3. **No valid associations**
   - Error: "No valid associations found for call"
   - Cause: All associated objects missing in HubSpot
   - Result: Call skipped

4. **Timestamp parsing failure**
   - Warning: "Unable to parse timestamp"
   - Fallback: Uses current timestamp

### Viewing Errors

Check the dashboard's "Errors" section for:

- Activity ID
- Error message
- Retry status

Or query database:

```sql
SELECT * FROM migration_errors
WHERE run_id = 'your-run-id'
ORDER BY created_at DESC;
```

## Data Validation

After migration, verify:

1. **Call Count**

   ```sql
   SELECT COUNT(*) FROM id_mappings
   WHERE salesforce_type = 'Task' AND hubspot_type = 'call';
   ```

2. **Sample Calls in HubSpot**
   - Go to HubSpot → CRM → Calls
   - Check associations (Contact, Company, Deal)
   - Verify properties (title, body, timestamp, owner)

3. **Error Rate**
   - Should be low if objects were migrated first
   - Check dashboard for failed count

## Troubleshooting

### Excel Files Not Found

```
Error: ENOENT: no such file or directory
```

**Solution**: Ensure files are in `data/call-data/` with exact names

### Worker Not Processing

```
Worker is running in passive mode
Waiting for migration tasks...
```

**Solution**: Check migration run status in database:

```sql
SELECT id, status, config_snapshot FROM migration_runs
ORDER BY started_at DESC LIMIT 1;
```

If status is not 'queued', update it:

```sql
UPDATE migration_runs SET status = 'queued' WHERE id = 'your-run-id';
```

### Rate Limit Errors

```
Error: 429 Too Many Requests
```

**Solution**:

- Worker already has rate limiting (8 req/sec)
- If still hitting limits, reduce batch size in `config/index.ts`

### Association Type ID Errors

```
Error: Invalid association type ID
```

**Solution**: Verify association type IDs haven't changed:

- Contact → Call: 194
- Company → Call: 182
- Deal → Call: 206

## Performance Tips

1. **Run during off-peak hours** - Less competition for API rate limits
2. **Monitor HubSpot API usage** - Check your HubSpot account's API limit
3. **Increase batch size** (if API limits allow) - Edit `migrator.ts` line 3260
4. **Use parallel database inserts** - Already implemented in bulk operations

## Rollback

To delete migrated calls and re-run:

```bash
cd worker
npx tsx -e "
import hubspotLoader from './src/loaders/hubspot';
const deleted = await hubspotLoader.deleteAllCalls();
console.log(\`Deleted \${deleted} calls\`);
"
```

**Warning**: This deletes ALL calls in HubSpot, not just migrated ones!

## Next Steps

After successful call migration:

1. Validate data in HubSpot
2. Update any custom workflows/automations
3. Train team on new call data
4. Archive Excel files

## Support

For issues:

1. Check worker logs for detailed errors
2. Review dashboard error table
3. Query `migration_errors` table
4. Check Salesforce IDs exist in HubSpot

---

**Happy Migrating! 📞**
