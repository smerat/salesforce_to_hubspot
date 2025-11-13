# Dashboard Update - Call Migration Option Added

## What Was Added

The dashboard now includes a user-friendly option to create call migrations directly from the UI.

## File Modified

**`dashboard/app/migrate/page.tsx`**
- Added `call_migration_from_excel` to MigrationType enum
- Added migration type name mapping: "Call migration from Excel files"
- Added UI button with icon and description

## UI Location

Navigate to: **http://localhost:3000/migrate**

You'll now see a new migration option:

```
📞 Calls from Excel Files (Excel → HubSpot)
Migrate Salesforce Call/Task activities from Excel files to HubSpot Call engagements
with associations to Contacts, Companies, and Deals (~2,800 calls)
```

## How to Use

1. **Start the Dashboard**
   ```bash
   cd dashboard
   npm run dev
   ```

2. **Navigate to Migration Page**
   - Visit http://localhost:3000
   - Click "New Migration" button
   - Or go directly to http://localhost:3000/migrate

3. **Select Call Migration**
   - Scroll to find "📞 Calls from Excel Files"
   - Click the card

4. **Preview & Configure**
   - Review migration details
   - Choose test mode or full migration:
     - **"Start Test Migration (5 records)"** - Tests with 5 calls only
     - **"Start Full Migration"** - Processes all ~2,800 calls

5. **Start Worker**
   ```bash
   cd worker
   npm run dev
   ```

6. **Monitor Progress**
   - Dashboard automatically redirects to progress view
   - Real-time updates show:
     - Total calls to process
     - Processed count
     - Failed count
     - Errors (if any)

## Benefits of Using Dashboard

✅ **No command line required** - User-friendly interface
✅ **Test mode built-in** - Easy to test with 5 records first
✅ **Visual confirmation** - See exactly what will be migrated
✅ **Automatic monitoring** - Redirects to progress tracking
✅ **Error visibility** - See errors in real-time table

## Alternative Method (Still Available)

You can also create migrations using the test script:
```bash
cd worker
npx tsx test-call-migration.ts
```

## What Happens When You Click "Start Migration"

1. Dashboard creates a record in `migration_runs` table
2. Status: `queued`
3. Config includes:
   - `migrationType: "call_migration_from_excel"`
   - `testMode: true/false`
   - `testModeLimit: 5` (if test mode)
4. Worker (if running) picks up the queued migration
5. Migration executes automatically
6. Progress updates in real-time on dashboard

## Screenshots

### Migration Selection Page
```
┌─────────────────────────────────────────────┐
│  Select Migration Type                      │
│                                             │
│  📞 Calls from Excel Files                  │
│     (Excel → HubSpot)                       │
│                                             │
│  Migrate Salesforce Call/Task activities   │
│  from Excel files to HubSpot Call          │
│  engagements with associations to          │
│  Contacts, Companies, and Deals            │
│  (~2,800 calls)                            │
└─────────────────────────────────────────────┘
```

### Preview Page
```
┌─────────────────────────────────────────────┐
│  Migration Preview                          │
│                                             │
│  Type: Call migration from Excel files      │
│  Source: Excel files (3 files)             │
│  Target: HubSpot Calls                     │
│  Records: ~2,800 unique calls              │
│                                             │
│  [Start Test Migration (5 records)]         │
│  [Start Full Migration]                     │
└─────────────────────────────────────────────┘
```

## Testing Flow

1. Dashboard: Click "Start Test Migration (5 records)"
2. Worker: Processes 5 calls with all associations
3. Dashboard: Shows real-time progress
4. HubSpot: Check 5 new calls were created
5. If successful: Click "Start Full Migration"
6. Worker: Processes all ~2,800 calls
7. Dashboard: Monitor until completion

## Validation After Migration

In the dashboard, you'll see:
- **Total Records**: 2,800 (or 5 in test mode)
- **Processed**: Count of successfully created calls
- **Failed**: Count of failed calls (should be low)
- **Errors Table**: Details of any failures

Common reasons for failures:
- Associated Contact/Company/Deal not in HubSpot
- Owner name doesn't match HubSpot (uses fallback)
- Invalid data in Excel

## Summary

The dashboard now provides a complete, user-friendly interface for call migration:
- ✅ Easy to find and select
- ✅ Clear description
- ✅ Test mode support
- ✅ Real-time monitoring
- ✅ Error visibility

No need to use command line scripts anymore (though they're still available)!
