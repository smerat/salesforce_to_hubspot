# Salesforce Account ID Field

## Overview

The worker now automatically stores the Salesforce Account ID in HubSpot's `salesforce_account_id` field for every migrated company.

---

## Implementation

### Automatic Field Assignment

Every Account migrated from Salesforce will have its ID stored in TWO HubSpot fields:

1. **`salesforce_id`** - General tracking field (existing)
2. **`salesforce_account_id`** - Specific Account ID field (NEW)

### Code Location

`worker/src/services/migrator.ts` - Line ~328:

```typescript
// Add Salesforce IDs for tracking and reference
properties["salesforce_id"] = record.Id;
properties["salesforce_account_id"] = record.Id;  // ← NEW
```

---

## Behavior

### What Gets Stored

**Salesforce Account:**
```
Id: "001abc123def456"
Name: "Acme Corporation"
```

**HubSpot Company (created):**
```json
{
  "name": "Acme Corporation",
  "salesforce_id": "001abc123def456",
  "salesforce_account_id": "001abc123def456",
  "hubspot_owner_id": "12345",
  ...other mapped fields
}
```

### Why Two Fields?

- **`salesforce_id`** - Generic field, could be used for any Salesforce object
- **`salesforce_account_id`** - Explicit field name makes it clear this came from an Account

This allows for future migrations where:
- Contacts store their SF Contact ID in `salesforce_id`
- But also reference their Account via `salesforce_account_id` on the contact

---

## Use Cases

### 1. Cross-Reference Lookup

Query HubSpot companies by Salesforce Account ID:
```
GET /crm/v3/objects/companies?properties=salesforce_account_id
Filter by salesforce_account_id = "001abc123"
```

### 2. Duplicate Prevention

Before creating a company, check if it already exists:
```javascript
// Check if Account already migrated
const existing = await hubspot.crm.companies.searchApi.doSearch({
  filterGroups: [{
    filters: [{
      propertyName: 'salesforce_account_id',
      operator: 'EQ',
      value: sfAccountId
    }]
  }]
});
```

### 3. Data Integrity

Verify migration accuracy:
```sql
-- In your application
SELECT
  hs.id as hubspot_company_id,
  hs.salesforce_account_id,
  sf.Id as salesforce_account_id,
  hs.name as hs_name,
  sf.Name as sf_name
FROM hubspot_companies hs
JOIN salesforce_accounts sf
  ON hs.salesforce_account_id = sf.Id
WHERE hs.name != sf.Name;
```

### 4. Future Deal Migration

When migrating Opportunities → Deals:
- Deal needs to associate to Company
- Look up Company by `salesforce_account_id` = Opportunity.AccountId
- Create association

---

## Field Configuration

### HubSpot Property Setup

If the field doesn't exist in HubSpot, you may need to create it:

**Property Name:** `salesforce_account_id`
**Label:** Salesforce Account ID
**Type:** Single-line text
**Field Type:** Text
**Group:** Company Information (or Integration)
**Description:** The Salesforce Account ID for tracking and reference

Most HubSpot instances already have this field or a similar one.

---

## Automatic vs Manual

### Automatic (Current Implementation)

✅ **Always added** - No user configuration needed
✅ **Consistent** - Every company gets this field
✅ **No extra API calls** - Set during creation

The worker automatically adds both IDs:
```typescript
properties["salesforce_id"] = record.Id;
properties["salesforce_account_id"] = record.Id;
```

### Why Not User-Configurable?

This field is **essential for data integrity** and tracking:
- Prevents duplicates in future migrations
- Enables cross-system reporting
- Required for future association mappings (deals, contacts)
- Standard practice for integration patterns

Therefore, it's automatically included rather than optional in the UI.

---

## Migration Examples

### Example 1: First Migration

```
SF Account: 001abc123 "Acme Corp"
  ↓ Migration
HS Company: 12345
  - name: "Acme Corp"
  - salesforce_id: "001abc123"
  - salesforce_account_id: "001abc123"
```

### Example 2: Finding Companies

```javascript
// Get all companies with Salesforce IDs
const companies = await hubspot.crm.companies.getAll({
  properties: ['name', 'salesforce_account_id', 'domain']
});

companies.results.forEach(company => {
  console.log(`${company.properties.name} - SF ID: ${company.properties.salesforce_account_id}`);
});
```

---

## Verification

### After Migration - Check HubSpot

1. Open any migrated company in HubSpot
2. Look for "Salesforce Account ID" property
3. Should contain value like: `001abc123def456`
4. Matches the Account ID in Salesforce

### Query Database

```sql
-- Check id_mappings table
SELECT
  salesforce_id,
  salesforce_type,
  hubspot_id,
  hubspot_type
FROM id_mappings
WHERE run_id = 'your-migration-run-id'
LIMIT 10;
```

---

## Impact on Existing Migrations

### Already Migrated Companies?

If you already ran migrations before this change:
- Companies have `salesforce_id` ✓
- Companies DON'T have `salesforce_account_id` ✗

**Options:**
1. **Re-migrate (Test Mode)** - Run test migration to verify field is added
2. **Update Script** - Bulk update existing companies to copy `salesforce_id` → `salesforce_account_id`
3. **Leave As-Is** - Only new migrations will have this field

### Update Script Example

```javascript
// Bulk update existing companies
const companies = await hubspot.crm.companies.getAll({
  properties: ['salesforce_id']
});

for (const company of companies.results) {
  if (company.properties.salesforce_id && !company.properties.salesforce_account_id) {
    await hubspot.crm.companies.basicApi.update(company.id, {
      properties: {
        salesforce_account_id: company.properties.salesforce_id
      }
    });
  }
}
```

---

## Files Changed

1. **`worker/src/services/migrator.ts`** - Added automatic field assignment
2. **`dashboard/components/FieldMapper.tsx`** - Added to suggestions (for reference)
3. **`worker/src/services/field-discovery.ts`** - Added to common mappings

---

## Testing

### Test Migration

1. Run a test migration (5 records)
2. Check HubSpot companies
3. Verify each has `salesforce_account_id` populated
4. Value should match Salesforce Account ID

### Verification Query

```javascript
const company = await hubspot.crm.companies.getById('12345', {
  properties: ['name', 'salesforce_id', 'salesforce_account_id']
});

console.log({
  name: company.properties.name,
  salesforce_id: company.properties.salesforce_id,
  salesforce_account_id: company.properties.salesforce_account_id,
  match: company.properties.salesforce_id === company.properties.salesforce_account_id
});

// Output should show match: true
```

---

## Summary

✅ **Automatically added** - No configuration needed
✅ **Both fields populated** - `salesforce_id` and `salesforce_account_id`
✅ **Same value** - Both contain the Salesforce Account ID
✅ **Future-proof** - Enables complex migrations (deals, contacts)
✅ **Standard practice** - Common integration pattern

The Salesforce Account ID is now reliably stored in HubSpot for every migrated company!
