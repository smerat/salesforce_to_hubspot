# Salesforce to HubSpot Migration Solution

Complete migration solution with **user-controlled field mapping** and **real-time monitoring**.

## 🎯 Key Features

- ✅ **Dashboard-Driven**: All migrations initiated from web UI
- ✅ **Dynamic Field Mapping**: Select and map fields visually
- ✅ **Pre-Migration Preview**: See sample data before migrating
- ✅ **Worker Polling**: Background worker processes queued migrations
- ✅ **Real-Time Progress**: Live updates via Supabase Realtime
- ✅ **Error Tracking**: Detailed error logs with retry capability
- ✅ **Dark Mode UI**: Modern Tailwind CSS 4.0 + shadcn/ui

## 📦 Architecture

```
┌──────────────────────────────────────┐
│   Dashboard (Next.js)                │
│   1. User selects migration type     │
│   2. Maps SF fields → HS fields      │
│   3. Previews sample data            │
│   4. Queues migration                │
│   5. Monitors progress in real-time  │
└─────────────┬────────────────────────┘
              │
              ▼
┌──────────────────────────────────────┐
│   Supabase PostgreSQL                │
│   - Stores migration queue           │
│   - Tracks progress                  │
│   - Logs errors                      │
│   - Realtime subscriptions           │
└─────────────┬────────────────────────┘
              │
              ▼
┌──────────────────────────────────────┐
│   Worker (Node.js - Passive)         │
│   1. Polls for queued migrations     │
│   2. Reads field mapping config      │
│   3. Extracts from Salesforce        │
│   4. Transforms data                 │
│   5. Loads to HubSpot                │
│   6. Updates progress                │
└──────────────────────────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Supabase account (free tier works)
- Salesforce account with API access
- HubSpot account with Private App access token

### 1. Set Up Supabase

```bash
# Link to your project
cd /path/to/Salesforce_to_hubspot
supabase link --project-ref YOUR_PROJECT_REF

# Apply database migrations
supabase db push
```

### 2. Configure Worker

```bash
cd worker
npm install
cp .env.example .env
```

Edit `worker/.env`:
```bash
SUPABASE_DB_URL=postgresql://postgres.YOUR_REF:PASSWORD@aws-0-region.pooler.supabase.com:5432/postgres
SF_LOGIN_URL=https://login.salesforce.com
SF_USERNAME=your@email.com
SF_PASSWORD=yourpassword
SF_SECURITY_TOKEN=token
HUBSPOT_ACCESS_TOKEN=pat-na1-xxxxx
```

### 3. Configure Dashboard

```bash
cd ../dashboard
npm install
cp .env.local.example .env.local
```

Edit `dashboard/.env.local`:
```bash
# Frontend (Supabase)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Backend API routes
SF_LOGIN_URL=https://login.salesforce.com
SF_USERNAME=your@email.com
SF_PASSWORD=yourpassword
SF_SECURITY_TOKEN=token
HUBSPOT_ACCESS_TOKEN=pat-na1-xxxxx
```

### 4. Start Services

**Terminal 1 - Worker:**
```bash
cd worker
npm run dev
```
Output:
```
🔧 Salesforce to HubSpot Migration Worker
==========================================
Worker is running in passive mode
Waiting for migration tasks from dashboard...
🔍 Started polling for queued migrations...
```

**Terminal 2 - Dashboard:**
```bash
cd dashboard
npm run dev
```
Open http://localhost:3000

## 📖 Usage Workflow

### Step 1: Start New Migration

1. Open dashboard at http://localhost:3000
2. Click **"New Migration"** button
3. Select **"Salesforce Account → HubSpot Company"**

### Step 2: Map Fields

The dashboard automatically discovers all available fields:

```
Field Mapping Configuration
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Salesforce Account          →    HubSpot Company
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[✓] Name                    →    [name ▼]
[✓] Website                 →    [domain ▼]
[✓] Phone                   →    [phone ▼]
[ ] Industry                →    [Select... ▼]
[ ] Custom_Field__c         →    [Select... ▼]
```

- **Check/uncheck** fields to include/exclude
- **Select HubSpot property** for each field
- Smart suggestions pre-filled
- Click **"Next: Preview Migration"**

### Step 3: Preview Migration

See exactly what will happen:

```
Migration Preview
━━━━━━━━━━━━━━━━━━━━━━━━━
Source: 110 Salesforce Accounts
Destination: 110 HubSpot Companies
Fields: 8 selected
Estimated time: ~5 minutes

Sample Data (first 3 records):
━━━━━━━━━━━━━━━━━━━━━━━━━

1. Acme Corporation
   Name: Acme Corporation → name: Acme Corporation
   Website: acme.com → domain: acme.com
   Phone: 555-1234 → phone: 555-1234
   ...
```

- Review sample transformations
- Click **"Start Migration"** to confirm

### Step 4: Monitor Progress

Migration is queued and worker picks it up:

- Real-time progress bars
- Success/failure counts
- Error details
- Duration tracking

### Step 5: Review Results

When complete:

```
Migration Complete ✓
━━━━━━━━━━━━━━━━━━━━━━━━━
Successfully migrated: 105 companies
Failed: 5 companies
Duration: 4m 32s

[View Error Details] [Export Report]
```

## 🎨 Dashboard Features

### Main Dashboard (`/`)
- View all migration runs
- Select run to see details
- Real-time progress updates
- Error tracking

### Migration Wizard (`/migrate`)
- **Step 1**: Select migration type
- **Step 2**: Map fields dynamically
- **Step 3**: Preview with sample data
- **Step 4**: Queue migration

### Real-Time Updates
- Progress bars update automatically
- No page refresh needed
- Powered by Supabase Realtime

## 🛠️ Worker Details

The worker runs continuously in **passive mode**:

```typescript
// Polls every 5 seconds
while (isPolling) {
  // Check for queued migrations
  const queued = await getQueuedMigrations();

  for (const migration of queued) {
    // Read field mapping config
    const config = migration.config_snapshot;

    // Extract only selected fields
    await extractFromSalesforce(config.fieldMappings);

    // Transform using mappings
    await transform(config.fieldMappings);

    // Load to HubSpot
    await loadToHubSpot();

    // Update progress in Supabase
  }

  await sleep(5000);
}
```

**Key Points:**
- ✅ Worker doesn't auto-migrate
- ✅ Only processes when dashboard queues
- ✅ Reads field mapping from database
- ✅ Updates progress in real-time
- ✅ Handles errors gracefully

## 🗂️ Project Structure

```
Salesforce_to_hubspot/
├── supabase/
│   └── migrations/              # Database schema
├── worker/                      # Background worker
│   ├── src/
│   │   ├── extractors/
│   │   │   └── salesforce.ts   # SF API integration
│   │   ├── loaders/
│   │   │   └── hubspot.ts      # HS API integration
│   │   ├── services/
│   │   │   ├── database.ts     # Supabase operations
│   │   │   ├── migrator.ts     # Migration orchestrator
│   │   │   └── field-discovery.ts
│   │   └── index.ts            # Polling loop
│   └── .env
└── dashboard/                   # Next.js dashboard
    ├── app/
    │   ├── page.tsx            # Main dashboard
    │   ├── migrate/
    │   │   └── page.tsx        # Migration wizard
    │   └── api/
    │       ├── fields/
    │       │   ├── salesforce/route.ts
    │       │   └── hubspot/route.ts
    │       └── preview/route.ts
    ├── components/
    │   ├── FieldMapper.tsx     # Field mapping UI
    │   ├── MigrationPreview.tsx
    │   ├── ProgressCard.tsx
    │   └── ErrorsTable.tsx
    └── .env.local
```

## 🔧 Customization

### Add Custom Field Mappings

Fields are discovered automatically, but you can add smart suggestions:

Edit `dashboard/app/api/fields/salesforce/route.ts`:

```typescript
const commonMaps: Record<string, string> = {
  Name: 'name',
  Website: 'domain',
  // Add your custom mappings
  Custom_Field__c: 'custom_hubspot_property',
};
```

### Add More Migration Types

Currently supports:
- ✅ Account → Company

To add more (Contact, Opportunity, etc.):
1. Add option in `dashboard/app/migrate/page.tsx`
2. Add migration logic in `worker/src/services/migrator.ts`
3. Follow same pattern

## 📊 Database Schema

**Key Tables:**
- `migration_runs` - Migration jobs (queued/running/completed)
- `migration_progress` - Per-object progress tracking
- `id_mappings` - SF ID → HS ID relationships
- `migration_errors` - Failed records with details
- `audit_log` - Complete history

## 🚨 Troubleshooting

### Worker Not Picking Up Jobs

1. Check worker is running: `npm run dev` in worker directory
2. Check console shows: "🔍 Started polling for queued migrations..."
3. Check Supabase connection in worker `.env`

### Field Discovery Fails

1. Check SF/HS credentials in dashboard `.env.local`
2. Check API permissions (Describe metadata for SF, Read properties for HS)
3. Check browser console for errors

### Migration Stalls

1. Check worker logs for errors
2. Check Supabase for error records
3. Worker may have crashed - restart it

## 🎓 Key Differences from Original

| Feature | Before | Now |
|---------|--------|-----|
| **Initiation** | Worker auto-runs | Dashboard queues |
| **Field Mapping** | Hardcoded in code | Visual UI selection |
| **Preview** | None | Sample data shown |
| **Worker Mode** | Active (runs immediately) | Passive (waits for tasks) |
| **Flexibility** | Fixed mappings | Dynamic per migration |

## 📝 Next Steps

1. ✅ Test with small dataset first
2. ✅ Review field mappings carefully
3. ✅ Check sample preview matches expectations
4. ✅ Monitor first migration closely
5. ⏸️ Add more migration types as needed

---

**Ready to migrate! 🚀**

For issues, check worker logs and Supabase error table.
