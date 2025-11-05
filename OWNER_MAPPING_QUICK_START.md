# Owner Mapping - Quick Start Guide

## What This Does

Automatically assigns HubSpot company owners based on Salesforce Account owners by matching user emails between systems.

---

## How to Use

### Step 1: Start a Migration

Navigate to the dashboard and click **"New Migration"**

### Step 2: Field Mapping

In the Field Mapper screen:

1. Find **OwnerId** in the Salesforce fields list
2. It should already be mapped to **hubspot_owner_id** ✓
3. Check the box to enable it
4. Continue to preview

### Step 3: Queue Migration

Click **"Start Migration"** - the system will:
- Match Salesforce users to HubSpot owners by email
- Assign owners automatically during migration

### Step 4: Monitor

Watch the worker logs for:
```
Initializing owner mapper...
Found 50 active Salesforce users
Found 45 HubSpot owners
Created 42 owner mappings
Mapped owner: SF User 005abc... → HS Owner 12345
```

---

## Requirements

### For Owner Mapping to Work:

1. **Same Email Addresses**
   - Users must have the same email in both Salesforce and HubSpot
   - Email matching is case-insensitive

2. **Active Users**
   - Salesforce: User must have `IsActive = true`
   - HubSpot: User must be an active owner

3. **Field Enabled**
   - OwnerId must be checked in Field Mapper

---

## What Happens to Unmatched Owners?

If a Salesforce user's email doesn't exist in HubSpot:

- ⚠️ Warning logged: "No HubSpot owner mapping found"
- ✅ Company still migrates successfully
- ❌ Owner field is left blank
- 🔧 Can be manually assigned in HubSpot later

**Example Log:**
```
WARN: No HubSpot owner found for Salesforce user
  sfUserId: 005abc123xyz
  sfUserName: John Smith
  sfUserEmail: john.smith@external-domain.com
```

---

## Troubleshooting

### Issue: No owners are being assigned

**Check:**
1. Is OwnerId enabled in Field Mapper? ✓
2. Do users have same email in SF and HS? ✓
3. Are SF users active? ✓
4. Are HS users valid owners? ✓

**Debug:**
Check `owner_mappings` table:
```sql
SELECT * FROM owner_mappings
WHERE run_id = 'your-run-id'
ORDER BY created_at DESC;
```

### Issue: Some owners not matched

**Cause:** Email mismatch or user not in HubSpot

**Solutions:**
1. Add user to HubSpot with matching email
2. Re-run migration
3. Or manually assign owner in HubSpot after migration

---

## Advanced: Manual Owner Mapping

If automatic matching fails, you can manually add mappings:

```sql
INSERT INTO owner_mappings
  (run_id, sf_user_id, sf_user_email, sf_user_name,
   hs_owner_id, hs_owner_email, hs_owner_name, match_method)
VALUES
  ('your-run-id', '005abc...', 'john@company.com', 'John Smith',
   '12345', 'j.smith@company.com', 'John Smith', 'manual');
```

Then the next migration run will use this mapping.

---

## FAQ

**Q: Does this slow down migration?**
A: No, only ~3-5 seconds one-time setup. Lookups are instant (in-memory cache).

**Q: What if I don't want owner assignment?**
A: Simply uncheck OwnerId in Field Mapper.

**Q: Can I map to a default owner for unmatched users?**
A: Not yet - this is a future enhancement. Currently unmatched = no owner assigned.

**Q: Does this work for Contacts and Deals too?**
A: The infrastructure is ready, but currently only implemented for Account → Company. Contact and Deal migrations can easily add this in the future.

**Q: Are mappings reused across migrations?**
A: Yes! Mappings are stored in the database per run_id, but you can load previous mappings for new runs (future enhancement).

---

## Success Indicators

✅ Log shows "Owner mapper initialized successfully"
✅ Log shows "Created X owner mappings" where X > 0
✅ Companies appear in HubSpot with owners assigned
✅ `owner_mappings` table has records

---

## Support

For issues:
1. Check worker logs for warnings
2. Verify email addresses match between systems
3. Check `owner_mappings` table for stored mappings
4. Review `migration_errors` table for failures
