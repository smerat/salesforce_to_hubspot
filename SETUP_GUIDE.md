# Setup Guide - Step by Step

This guide will walk you through setting up the Salesforce to HubSpot migration solution from scratch.

## Step 1: Prerequisites

### 1.1 Install Required Software

```bash
# Check Node.js version (should be 18+)
node --version

# Install Supabase CLI
npm install -g supabase

# Verify installation
supabase --version
```

### 1.2 Get API Credentials

**Salesforce:**
1. Log into Salesforce
2. Go to Settings → My Personal Information → Reset Security Token
3. Check your email for the security token
4. Note your username and password

**HubSpot:**
1. Log into HubSpot
2. Go to Settings → Integrations → Private Apps
3. Click "Create a private app"
4. Name it "Migration App"
5. Give it permissions:
   - CRM: Read/Write for Contacts, Companies, Deals
6. Copy the access token

## Step 2: Set Up Supabase

### 2.1 Create Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Sign up or log in
3. Click "New Project"
4. Choose a name and password
5. Select a region close to you
6. Wait for project to be created (~2 minutes)

### 2.2 Get Supabase Credentials

In your Supabase project dashboard:

1. Go to **Settings → API**
2. Copy:
   - Project URL: `https://xxxxx.supabase.co`
   - Anon/Public Key: `eyJhbGc...`

3. Go to **Settings → Database**
4. Scroll to "Connection string" → URI
5. Copy and replace `[YOUR-PASSWORD]` with your database password

### 2.3 Apply Database Migrations

```bash
# Navigate to your project
cd /path/to/Salesforce_to_hubspot

# Link to your Supabase project
supabase link --project-ref your-project-ref

# You'll be prompted for your database password

# Apply migrations
supabase db push
```

You should see:
```
✓ Applied migration 20240101000000_create_migration_tables.sql
✓ Applied migration 20240101000001_create_indexes.sql
```

### 2.4 Verify Database Setup

```bash
# Check tables were created
supabase db query "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
```

You should see:
- migration_runs
- migration_progress
- id_mappings
- migration_errors
- audit_log

## Step 3: Set Up Migration Worker

### 3.1 Install Dependencies

```bash
cd worker
npm install
```

### 3.2 Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```bash
# Supabase (from Step 2.2)
SUPABASE_DB_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:6543/postgres?pgbouncer=true

# Salesforce (from Step 1.2)
SF_LOGIN_URL=https://login.salesforce.com
SF_USERNAME=your@email.com
SF_PASSWORD=yourpassword
SF_SECURITY_TOKEN=yoursecuritytoken

# HubSpot (from Step 1.2)
HUBSPOT_ACCESS_TOKEN=pat-na1-xxxxx

# Configuration (defaults are fine)
BATCH_SIZE=100
MAX_RETRIES=3
RATE_LIMIT_DELAY_MS=100
LOG_LEVEL=info
```

**Important:**
- For Salesforce sandbox, use `SF_LOGIN_URL=https://test.salesforce.com`
- The security token is appended to your password in the code (don't append it yourself)

### 3.3 Test Connection

```bash
npm run dev -- --object=contacts
```

You should see:
```
🔧 Salesforce to HubSpot Migration Worker
==========================================
Connecting to Salesforce...
✓ Successfully connected to Salesforce
Starting migration for: contacts
```

If you get errors:
- **Authentication error**: Check SF credentials and security token
- **Database error**: Check Supabase connection string
- **Module not found**: Run `npm install` again

## Step 4: Set Up Dashboard

### 4.1 Install Dependencies

```bash
cd ../dashboard
npm install
```

### 4.2 Configure Environment

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```bash
# From Supabase Settings → API
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
```

### 4.3 Start Dashboard

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

You should see:
- Migration Dashboard
- "No migration runs found" (initially)

## Step 5: Run Your First Migration

### 5.1 Test with Small Dataset

**Option 1: From Dashboard**
1. Click "New Migration" button
2. Migration will be queued
3. In terminal, run worker:
   ```bash
   cd ../worker
   npm run dev
   ```

**Option 2: Direct from Worker**
```bash
cd worker
npm run migrate:contacts
```

### 5.2 Monitor Progress

Watch in the dashboard:
- Progress bars updating in real-time
- Record counts increasing
- Any errors appearing in the errors table

Watch in the terminal:
- Detailed logs of extraction and loading
- Batch progress
- Success/failure messages

### 5.3 Verify in HubSpot

1. Log into HubSpot
2. Go to Contacts/Companies/Deals
3. Check that records were created
4. Verify data accuracy

## Step 6: Customize Field Mappings

Before migrating all data, customize field mappings:

### 6.1 Edit Field Mappings

```bash
cd worker/src/transformers
# Edit field-mappings.ts
```

Add your custom fields:

```typescript
export const contactFieldMappings: FieldMapping[] = [
  { salesforceField: 'Email', hubspotField: 'email', required: true },
  { salesforceField: 'FirstName', hubspotField: 'firstname' },
  { salesforceField: 'LastName', hubspotField: 'lastname', required: true },
  // Add your custom Salesforce fields here
  { salesforceField: 'Custom_Field__c', hubspotField: 'custom_hubspot_field' },
];
```

### 6.2 Create Custom HubSpot Properties

If mapping to custom HubSpot properties:

1. Go to HubSpot Settings → Properties
2. Create custom properties for Contacts/Companies/Deals
3. Note the internal names (lowercase_with_underscores)
4. Use these names in field mappings

### 6.3 Map Deal Stages

Edit `mapDealStage` function in `field-mappings.ts`:

```typescript
function mapDealStage(salesforceStage: string): string {
  const stageMapping: Record<string, string> = {
    'Your SF Stage 1': 'your_hs_stage_1',
    'Your SF Stage 2': 'your_hs_stage_2',
    // Add all your stage mappings
  };
  return stageMapping[salesforceStage] || 'appointmentscheduled';
}
```

## Step 7: Production Migration

### 7.1 Plan Migration Order

Recommended order:
1. **Companies** (Accounts) - Base entities
2. **Contacts** - Associated with Companies
3. **Deals** (Opportunities) - Associated with Companies

### 7.2 Run Full Migration

```bash
cd worker

# Migrate all objects in order
npm run dev

# Or migrate one at a time
npm run migrate:companies
# Wait for completion, then:
npm run migrate:contacts
# Wait for completion, then:
npm run migrate:deals
```

### 7.3 Handle Errors

If errors occur:

1. Check dashboard errors table
2. Fix data in Salesforce or adjust field mappings
3. Query failed records:
   ```bash
   supabase db query "SELECT * FROM migration_errors WHERE status = 'pending_retry'"
   ```
4. Re-run migration (will skip already migrated records)

## Step 8: Validation

### 8.1 Compare Record Counts

```bash
# In Supabase
supabase db query "
  SELECT
    object_type,
    total_records,
    processed_records,
    failed_records
  FROM migration_progress
  WHERE run_id = 'your-run-id'
"
```

Compare with Salesforce and HubSpot record counts.

### 8.2 Spot Check Records

1. Pick random records from Salesforce
2. Find them in HubSpot (search by email/name)
3. Verify all fields migrated correctly
4. Check associations (Contact → Company, Deal → Company)

### 8.3 Export ID Mappings

```bash
supabase db query "
  SELECT * FROM id_mappings
  WHERE salesforce_type = 'Contact'
" > contact_mappings.csv
```

Keep these for reference.

## Troubleshooting

### Worker Won't Start

**Error: Cannot find module**
```bash
cd worker
rm -rf node_modules package-lock.json
npm install
```

**Error: Database connection failed**
- Check `SUPABASE_DB_URL` has correct password
- Verify project isn't paused in Supabase dashboard
- Test connection: `supabase db query "SELECT 1"`

### Dashboard Not Loading

**Error: Module not found**
```bash
cd dashboard
rm -rf node_modules package-lock.json .next
npm install
npm run dev
```

**Dashboard shows no data**
- Check `.env.local` has correct Supabase URL and key
- Verify migration has run (check database)
- Check browser console for errors

### API Rate Limit Errors

**Salesforce: "REQUEST_LIMIT_EXCEEDED"**
- Reduce `BATCH_SIZE` in `.env`
- Increase `RATE_LIMIT_DELAY_MS`
- Check daily API limit in Salesforce Setup

**HubSpot: 429 Too Many Requests**
- Rate limiter should handle this automatically
- If persistent, reduce batch size
- Check HubSpot API usage in Settings

### Data Issues

**Required field missing**
- Check Salesforce data has required fields
- Update field mappings to mark as not required
- Add default values in transformer

**Field type mismatch**
- Add transform function in field mapping
- Convert types appropriately (string → number, date → timestamp)

**Custom fields not migrating**
- Verify custom field API names in Salesforce
- Add to field mappings
- Ensure HubSpot properties exist

## Next Steps

1. **Schedule Regular Syncs**: Set up cron job for incremental updates
2. **Add More Objects**: Extend to Tasks, Notes, etc.
3. **Custom Reporting**: Query Supabase for migration analytics
4. **Backup**: Keep ID mappings and audit logs

## Support

If you encounter issues:
1. Check logs in worker terminal
2. Review errors in dashboard
3. Query database for detailed error info
4. Check API quotas and limits

Happy migrating! 🚀
