# Quick Start Guide

Get up and running in 10 minutes!

## 1. Prerequisites (2 min)

```bash
# Verify Node.js 18+
node --version

# Install Supabase CLI
npm install -g supabase
```

## 2. Supabase Setup (3 min)

1. Create project at [supabase.com](https://supabase.com)
2. Copy credentials from Settings → API and Settings → Database
3. Apply migrations:

```bash
cd /path/to/Salesforce_to_hubspot
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

## 3. Worker Setup (2 min)

```bash
cd worker
npm install
cp .env.example .env
```

Edit `.env`:
```bash
SUPABASE_DB_URL=postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:6543/postgres?pgbouncer=true
SF_LOGIN_URL=https://login.salesforce.com
SF_USERNAME=your@email.com
SF_PASSWORD=yourpassword
SF_SECURITY_TOKEN=token
HUBSPOT_ACCESS_TOKEN=pat-na1-xxxxx
```

## 4. Dashboard Setup (2 min)

```bash
cd ../dashboard
npm install
cp .env.local.example .env.local
```

Edit `.env.local`:
```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

## 5. Run Migration (1 min)

Terminal 1 - Start Dashboard:
```bash
cd dashboard
npm run dev
# Open http://localhost:3000
```

Terminal 2 - Run Migration:
```bash
cd worker
npm run dev
```

That's it! Watch the dashboard for real-time progress. ✅

## Common Commands

```bash
# Migrate specific objects
npm run migrate:contacts
npm run migrate:companies
npm run migrate:deals

# Resume interrupted migration
npm run dev -- resume --run-id=YOUR_RUN_ID

# View errors
supabase db query "SELECT * FROM migration_errors"
```

## Need Help?

- 📖 Full docs: [README.md](./README.md)
- 🛠️ Detailed setup: [SETUP_GUIDE.md](./SETUP_GUIDE.md)
- 🔍 Check logs in worker terminal for errors
