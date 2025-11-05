# Quick Fix - Create New Test Migration

The current migration is stuck. **Don't try to fix it** - just create a new one!

## Steps:

1. **Go to the dashboard** in your browser: http://localhost:3000
2. **Click "New Migration"**
3. **Select migration type** (Account → Company)
4. **Map fields** - Enable the ones you want
5. **Click "Test Migration (5 records)"**
6. **Watch the worker terminal** - You should see the detailed HubSpot error

The old migration (18ec8cf5) has database conflicts from multiple retry attempts. A fresh migration will work properly.

---

## What to Look For

After you create a new test migration, watch the worker terminal for:

```
=== BATCH CREATE ERROR ===
Message: ...
Status: ...
Body: {
  "message": "Property 'salesforce_account_id' does not exist",
  ...
}
========================
```

This will tell us exactly what HubSpot property is missing or invalid.

---

## Most Likely Issue

HubSpot doesn't have a property called `salesforce_account_id`. We need to either:
1. Create this property in HubSpot, OR
2. Remove the automatic assignment of this field

Let me know what error you see!
