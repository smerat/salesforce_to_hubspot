# Salesforce to HubSpot Migration Solution

A comprehensive ETL (Extract, Transform, Load) solution for migrating data from Salesforce to HubSpot with real-time progress tracking and error management.

## 🏗️ Architecture

```
┌─────────────────────────────────────┐
│   Web Dashboard (Next.js)          │
│   - View progress                   │
│   - Trigger migrations              │
│   - Monitor errors                  │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│   Supabase Cloud                    │
│   - PostgreSQL (state/tracking)     │
│   - Realtime (live updates)         │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│   Migration Worker (Node.js)        │
│   - Extract from Salesforce         │
│   - Transform data                  │
│   - Load to HubSpot                 │
└─────────────────────────────────────┘
```

## 📋 Features

- **Automated Migration**: Extract data from Salesforce and load to HubSpot
- **Progress Tracking**: Real-time progress monitoring with Supabase
- **Error Handling**: Comprehensive error logging and retry mechanism
- **Resume Capability**: Resume interrupted migrations from last checkpoint
- **ID Mapping**: Track Salesforce ID to HubSpot ID mappings for associations
- **Web Dashboard**: Beautiful real-time dashboard to monitor migrations
- **Batch Processing**: Efficient batch operations with rate limiting
- **Field Mapping**: Customizable field mappings between Salesforce and HubSpot

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm
- Supabase account (free tier works)
- Salesforce account with API access
- HubSpot account with API access (Private App or OAuth)

### 1. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Install Supabase CLI:
   ```bash
   npm install -g supabase
   ```
3. Link your project:
   ```bash
   supabase link --project-ref your-project-ref
   ```
4. Apply database migrations:
   ```bash
   supabase db push
   ```

### 2. Set Up Migration Worker

```bash
cd worker
npm install
cp .env.example .env
```

Edit `.env` with your credentials:

```bash
# Supabase
SUPABASE_DB_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:6543/postgres?pgbouncer=true

# Salesforce
SF_LOGIN_URL=https://login.salesforce.com
SF_USERNAME=your@email.com
SF_PASSWORD=yourpassword
SF_SECURITY_TOKEN=yoursecuritytoken

# HubSpot
HUBSPOT_ACCESS_TOKEN=pat-na1-xxxxx

# Configuration
BATCH_SIZE=100
MAX_RETRIES=3
RATE_LIMIT_DELAY_MS=100
LOG_LEVEL=info
```

### 3. Set Up Dashboard

```bash
cd dashboard
npm install
cp .env.local.example .env.local
```

Edit `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

## 📖 Usage

### Running a Migration

**Option 1: Migrate All Objects**

```bash
cd worker
npm run dev
```

**Option 2: Migrate Specific Objects**

```bash
npm run migrate:contacts
npm run migrate:companies
npm run migrate:deals
```

**Option 3: Custom Object Selection**

```bash
npm run dev -- --object=companies,contacts
```

**Option 4: Resume a Migration**

```bash
npm run dev -- resume --run-id=your-run-id
```

### Starting the Dashboard

```bash
cd dashboard
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Creating a Migration from Dashboard

1. Click "New Migration" button
2. The migration will be queued in the database
3. Start the worker to begin processing
4. Watch real-time progress in the dashboard

## 🗂️ Project Structure

```
salesforce-to-hubspot/
├── supabase/
│   ├── migrations/               # Database schema migrations
│   │   ├── 20240101000000_create_migration_tables.sql
│   │   └── 20240101000001_create_indexes.sql
│   └── config.toml               # Supabase configuration
├── worker/                       # Node.js migration worker
│   ├── src/
│   │   ├── config/               # Configuration
│   │   ├── extractors/           # Salesforce data extraction
│   │   │   └── salesforce.ts
│   │   ├── transformers/         # Data transformation
│   │   │   ├── field-mappings.ts
│   │   │   └── index.ts
│   │   ├── loaders/              # HubSpot data loading
│   │   │   └── hubspot.ts
│   │   ├── services/             # Core services
│   │   │   ├── database.ts       # Supabase operations
│   │   │   └── migrator.ts       # Migration orchestrator
│   │   ├── types/                # TypeScript types
│   │   ├── utils/                # Utilities
│   │   │   ├── logger.ts
│   │   │   └── retry.ts
│   │   └── index.ts              # Entry point
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
└── dashboard/                    # Next.js dashboard
    ├── app/
    │   ├── page.tsx              # Main dashboard page
    │   ├── layout.tsx
    │   └── globals.css
    ├── components/
    │   ├── ProgressCard.tsx      # Progress display
    │   └── ErrorsTable.tsx       # Error table
    ├── lib/
    │   ├── supabase.ts           # Supabase client
    │   └── types.ts              # TypeScript types
    ├── package.json
    └── .env.local.example
```

## 🔧 Configuration

### Field Mappings

Customize field mappings in `worker/src/transformers/field-mappings.ts`:

```typescript
export const contactFieldMappings: FieldMapping[] = [
  { salesforceField: "Email", hubspotField: "email", required: true },
  { salesforceField: "FirstName", hubspotField: "firstname" },
  // Add your custom fields here
];
```

### Deal Stage Mapping

Map Salesforce stages to HubSpot stages in the `mapDealStage` function:

```typescript
const stageMapping: Record<string, string> = {
  Prospecting: "appointmentscheduled",
  Qualification: "qualifiedtobuy",
  // Customize for your pipelines
};
```

## 📊 Database Schema

### Tables

- **migration_runs**: Track migration executions
- **migration_progress**: Progress per object type
- **id_mappings**: Salesforce ID to HubSpot ID mappings
- **migration_errors**: Error tracking with retry logic
- **audit_log**: Complete audit trail

## 🔄 Migration Flow

1. **Create Migration Run**: Insert record in `migration_runs` table
2. **Extract**: Fetch data from Salesforce in batches
3. **Transform**: Map Salesforce fields to HubSpot format
4. **Load**: Batch create records in HubSpot
5. **Track**: Store ID mappings and update progress
6. **Handle Errors**: Log errors with retry capability
7. **Complete**: Mark migration as completed

## ⚙️ Advanced Usage

### Custom Salesforce Queries

Modify extraction in `worker/src/extractors/salesforce.ts`:

```typescript
const fields = [
  "Id",
  "Name",
  "CustomField__c", // Add your custom fields
];
```

### Rate Limiting

Adjust rate limits in the extractors/loaders:

```typescript
// Salesforce: 10 requests per second
this.rateLimiter = new RateLimiter(10, 10);

// HubSpot: 8 requests per second
this.rateLimiter = new RateLimiter(10, 8);
```

### Batch Size

Modify batch size in `.env`:

```bash
BATCH_SIZE=200  # Increase for faster migration (if API limits allow)
```

## 🔍 Monitoring

### View Progress

```bash
# Using Supabase CLI
supabase db query "SELECT * FROM migration_progress ORDER BY updated_at DESC"

# View errors
supabase db query "SELECT * FROM migration_errors WHERE status = 'pending_retry'"
```

### Dashboard Features

- **Real-time Updates**: Progress updates automatically via Supabase Realtime
- **Error Tracking**: View all errors with retry status
- **Statistics**: Overall migration statistics
- **Run History**: View past migration runs

## 🚨 Troubleshooting

### Connection Issues

```bash
# Test Supabase connection
cd worker
npm run dev -- --object=contacts
```

If connection fails:

- Check `SUPABASE_DB_URL` format
- Verify project is not paused
- Check firewall/network settings

### API Rate Limits

If hitting rate limits:

- Reduce `BATCH_SIZE` in `.env`
- Increase `RATE_LIMIT_DELAY_MS`
- Check Salesforce/HubSpot API usage

### Field Mapping Errors

Common issues:

- Required fields missing in Salesforce
- Field type mismatches
- Custom fields not in field mappings

Check logs for specific field errors and update mappings accordingly.

## 📝 Best Practices

1. **Test First**: Start with a small data subset
2. **Backup**: Export data before migration
3. **Validate**: Review field mappings before full migration
4. **Monitor**: Watch dashboard during migration
5. **Verify**: Check record counts and sample records after migration

## 🔐 Security

- Never commit `.env` files
- Use environment variables for credentials
- Use HubSpot Private Apps (not API keys)
- Rotate credentials after migration
- Enable Row Level Security on Supabase tables if needed

## 📦 Deployment

### Worker Deployment

**Option 1: Server/VPS**

```bash
# Use PM2 for process management
npm install -g pm2
pm2 start npm --name "migration-worker" -- start
```

**Option 2: Docker**

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY worker/package*.json ./
RUN npm ci --production
COPY worker .
CMD ["npm", "start"]
```

### Dashboard Deployment

Deploy to Vercel (recommended):

```bash
cd dashboard
npm install -g vercel
vercel
```

Or any Node.js hosting platform.

## 🤝 Contributing

Feel free to customize field mappings, add new object types, or enhance error handling for your specific needs.

## 📄 License

MIT

## 🆘 Support

For issues:

1. Check logs in `worker` for detailed error messages
2. Review Supabase dashboard for data issues
3. Check API quotas in Salesforce and HubSpot

---

**Happy Migrating! 🚀**
