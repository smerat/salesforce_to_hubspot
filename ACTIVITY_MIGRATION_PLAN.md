# Comprehensive Activity Migration Plan
## Salesforce to HubSpot Activities Migration

**Created:** 2025-11-05
**Status:** Ready for Implementation
**Estimated Timeline:** 7-8 days

---

## Executive Summary

This document outlines the comprehensive plan to migrate **4 activity types** from Salesforce to HubSpot with full association tracking and progress monitoring.

### Migration Scope

| Activity Type | Salesforce Object | HubSpot Object | Record Count | Status |
|--------------|-------------------|----------------|--------------|--------|
| **Meetings** | Event | Meeting | 1,560 | To Implement |
| **Emails (Rich)** | EmailMessage | Email | 1,587 | To Implement |
| **Emails (Logs)** | Task (Type=Email) | Email | 3,876 | To Implement |
| **Calls** | Task (Type=Call) | Call | TBD | To Implement |

**Total Records:** ~7,000+ activities

---

## Architecture Overview

### Migration Pattern: ETL with Association Tracking

```
┌──────────────┐
│  Salesforce  │
│   Extract    │
└──────┬───────┘
       │
       ▼
┌──────────────┐      ┌─────────────┐
│  ID Mapping  │◄─────┤  Database   │
│    Cache     │      │  Bulk Load  │
└──────┬───────┘      └─────────────┘
       │
       ▼
┌──────────────┐
│  Transform   │
│ Field Mapping│
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   HubSpot    │
│ Batch Create │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Associations │
│  to Contacts │
│  Companies   │
│  Deals       │
└──────────────┘
```

### Key Innovation: Bulk ID Mapping Cache

**Problem:** Activities have relationships that need lookups (WhoId → Contact, WhatId → Opportunity)

**Traditional Approach:** Query database for each activity (N+1 problem)
```typescript
for (activity of activities) {
  const contactId = await db.getMapping(activity.WhoId); // ❌ Slow!
}
```

**Our Approach:** Pre-load all mappings in bulk
```typescript
// Extract all related IDs from batch
const allIds = activities.flatMap(a => [a.WhoId, a.WhatId].filter(Boolean));

// Single bulk query
const mappings = await database.bulkGetIdMappings(allIds);
const cache = new Map(mappings.map(m => [m.salesforce_id, m]));

// O(1) lookups
for (activity of activities) {
  const mapping = cache.get(activity.WhoId); // ✅ Fast!
}
```

**Performance Impact:**
- Traditional: 100 activities × 2 lookups × 10ms = 2 seconds
- Bulk approach: 1 query × 15ms = 0.015 seconds
- **133x faster!**

---

## Implementation Plan

### Phase 1: Foundation Layer (Days 1-2)

#### 1.1 Database Service Enhancement

**File:** `worker/src/services/database.ts`

**Add Method:**
```typescript
async bulkGetIdMappings(
  salesforceIds: string[]
): Promise<Array<{
  salesforce_id: string;
  salesforce_type: string;
  hubspot_id: string;
  hubspot_type: string;
}>> {
  if (salesforceIds.length === 0) return [];

  const result = await this.query(`
    SELECT salesforce_id, salesforce_type, hubspot_id, hubspot_type
    FROM id_mappings
    WHERE salesforce_id = ANY($1::text[])
  `, [salesforceIds]);

  return result.rows;
}
```

**Purpose:** Eliminate N+1 query problem for activity associations

---

#### 1.2 HubSpot Loader Enhancement

**File:** `worker/src/loaders/hubspot.ts`

**Add Methods:**

**1. Create Meeting:**
```typescript
async createMeeting(properties: Record<string, any>): Promise<string> {
  await this.rateLimiter.waitForToken();

  const result = await retry(
    async () => {
      return await this.client.crm.objects.meetings.basicApi.create({
        properties,
        associations: []
      });
    },
    {
      maxRetries: config.migration.maxRetries,
      delayMs: 1000,
    }
  );

  return result.id;
}
```

**2. Create Email:**
```typescript
async createEmail(properties: Record<string, any>): Promise<string> {
  await this.rateLimiter.waitForToken();

  const result = await retry(
    async () => {
      return await this.client.crm.objects.emails.basicApi.create({
        properties,
        associations: []
      });
    },
    {
      maxRetries: config.migration.maxRetries,
      delayMs: 1000,
    }
  );

  return result.id;
}
```

**3. Create Call:**
```typescript
async createCall(properties: Record<string, any>): Promise<string> {
  await this.rateLimiter.waitForToken();

  const result = await retry(
    async () => {
      return await this.client.crm.objects.calls.basicApi.create({
        properties,
        associations: []
      });
    },
    {
      maxRetries: config.migration.maxRetries,
      delayMs: 1000,
    }
  );

  return result.id;
}
```

**4. Create Engagement Association:**
```typescript
async createEngagementAssociation(
  fromObjectType: string,  // 'meetings', 'emails', 'calls'
  fromObjectId: string,
  toObjectType: string,    // 'contacts', 'companies', 'deals'
  toObjectId: string,
  associationTypeId: number
): Promise<void> {
  await this.rateLimiter.waitForToken();

  try {
    await retry(
      async () => {
        await this.client.crm.associations.v4.basicApi.create(
          fromObjectType as any,
          fromObjectId,
          toObjectType as any,
          toObjectId,
          [
            {
              associationCategory: "HUBSPOT_DEFINED",
              associationTypeId: associationTypeId,
            },
          ] as any,
        );
      },
      {
        maxRetries: config.migration.maxRetries,
        delayMs: 1000,
      }
    );
  } catch (error: any) {
    logger.error("Failed to create engagement association", {
      error: error.message,
      fromObjectType,
      fromObjectId,
      toObjectType,
      toObjectId,
    });
    throw error;
  }
}
```

---

#### 1.3 Salesforce Extractor Enhancement

**File:** `worker/src/extractors/salesforce.ts`

**Add Methods:**

**1. Extract Events:**
```typescript
async extractEvents(
  batchSize: number = 200,
  lastId?: string,
): Promise<ExtractResult> {
  return this.extract(
    "Event",
    [
      "Id",
      "Subject",
      "Description",
      "Location",
      "StartDateTime",
      "EndDateTime",
      "DurationInMinutes",
      "IsAllDayEvent",
      "WhoId",
      "WhatId",
      "OwnerId",
      "Type"
    ],
    batchSize,
    lastId,
  );
}
```

**2. Extract Email Messages:**
```typescript
async extractEmailMessages(
  batchSize: number = 200,
  lastId?: string,
): Promise<ExtractResult> {
  return this.extract(
    "EmailMessage",
    [
      "Id",
      "Subject",
      "TextBody",
      "HtmlBody",
      "FromAddress",
      "ToAddress",
      "CcAddress",
      "BccAddress",
      "MessageDate",
      "Status",
      "Incoming",
      "RelatedToId",
      "ParentId",
      "ActivityId"
    ],
    batchSize,
    lastId,
  );
}
```

**3. Extract Email Tasks:**
```typescript
async extractEmailTasks(
  batchSize: number = 200,
  lastId?: string,
): Promise<ExtractResult> {
  return this.extract(
    "Task",
    [
      "Id",
      "Subject",
      "Description",
      "ActivityDate",
      "Status",
      "Priority",
      "WhoId",
      "WhatId",
      "OwnerId",
      "Type",
      "TaskSubtype"
    ],
    batchSize,
    lastId,
    "Type = 'Email' OR TaskSubtype = 'Email'",
  );
}
```

**4. Extract Call Tasks:**
```typescript
async extractCallTasks(
  batchSize: number = 200,
  lastId?: string,
): Promise<ExtractResult> {
  return this.extract(
    "Task",
    [
      "Id",
      "Subject",
      "Description",
      "ActivityDate",
      "Status",
      "Priority",
      "CallDurationInSeconds",
      "CallType",
      "CallDisposition",
      "WhoId",
      "WhatId",
      "OwnerId",
      "Type"
    ],
    batchSize,
    lastId,
    "Type = 'Call' OR CallDurationInSeconds != null",
  );
}
```

---

### Phase 2: Event to Meeting Migration (Days 3)

#### Migration Type Configuration

**Migration Type:** `event_to_meeting_migration`

**Object Type:** `activities` (uses existing database enum)

#### Field Mappings

| Salesforce Field | HubSpot Property | Transformation |
|-----------------|------------------|----------------|
| Subject | hs_meeting_title | Direct |
| Description | hs_meeting_body | Direct |
| Location | hs_meeting_location | Direct |
| StartDateTime | hs_meeting_start_time | Convert to Unix timestamp (ms) |
| EndDateTime | hs_meeting_end_time | Convert to Unix timestamp (ms) |
| OwnerId | hubspot_owner_id | Lookup via owner mapper |

#### Association Type IDs

| Association | HubSpot TypeId | Description |
|------------|----------------|-------------|
| Meeting → Contact | 200 | HUBSPOT_DEFINED |
| Meeting → Company | 182 | HUBSPOT_DEFINED |
| Meeting → Deal | 206 | HUBSPOT_DEFINED |

#### Implementation: Migrator Service

**File:** `worker/src/services/migrator.ts`

**Add to executeMigration():**
```typescript
} else if (migrationType === "event_to_meeting_migration") {
  await this.migrateEventsToMeetings(testMode, testModeLimit);
}
```

**Add Method:**
```typescript
private async migrateEventsToMeetings(
  testMode: boolean = false,
  testModeLimit: number = 5,
): Promise<void> {
  if (!this.runId) {
    throw new Error("No active migration run");
  }

  const objectType: ObjectType = "activities";

  logger.info("📦 Starting Event to Meeting migration");

  try {
    // Create progress tracking
    await database.createMigrationProgress(
      this.runId,
      objectType,
      "in_progress",
    );
    await database.updateMigrationProgress(this.runId, objectType, {
      started_at: new Date(),
    });

    // Get total count
    const totalRecords = await salesforceExtractor.getRecordCount("Event");
    const recordsToMigrate = testMode
      ? Math.min(testModeLimit, totalRecords)
      : totalRecords;

    await database.updateMigrationProgress(this.runId, objectType, {
      total_records: recordsToMigrate,
    });

    if (testMode) {
      logger.info(
        `🧪 TEST MODE: Will process ${recordsToMigrate} of ${totalRecords} total Events`,
      );
    } else {
      logger.info(`Total Events to migrate: ${totalRecords}`);
    }

    // Initialize owner mapper
    const connection = salesforceExtractor.getConnection();
    if (!connection) {
      throw new Error("Salesforce connection not available");
    }
    await ownerMapper.initialize(connection, this.runId);

    let lastId: string | undefined;
    let processedCount = 0;
    let successCount = 0;
    let failedCount = 0;
    let hasMore = true;

    while (hasMore && !this.shouldStop) {
      if (testMode && processedCount >= testModeLimit) {
        logger.info(
          `🧪 TEST MODE: Reached limit of ${testModeLimit} records, stopping`,
        );
        break;
      }

      const batchSize = testMode
        ? Math.min(config.migration.batchSize, testModeLimit - processedCount)
        : config.migration.batchSize;

      // Extract batch
      const extractResult = await salesforceExtractor.extractEvents(
        batchSize,
        lastId,
      );

      logger.info(
        `Extracted ${extractResult.records.length} Events from Salesforce`,
      );

      if (extractResult.records.length === 0) {
        break;
      }

      const recordsToProcess = testMode
        ? extractResult.records.slice(0, testModeLimit - processedCount)
        : extractResult.records;

      // Collect all related IDs for bulk lookup
      const relatedIds = new Set<string>();
      recordsToProcess.forEach((event) => {
        if (event.WhoId) relatedIds.add(event.WhoId);
        if (event.WhatId) relatedIds.add(event.WhatId);
      });

      // Bulk load ID mappings
      const idMappings = await database.bulkGetIdMappings(
        Array.from(relatedIds),
      );
      const idMappingCache = new Map(
        idMappings.map((m) => [m.salesforce_id, m]),
      );

      logger.debug(`Loaded ${idMappings.length} ID mappings into cache`);

      // Process each event
      for (const event of recordsToProcess) {
        if (this.shouldStop) break;

        try {
          const eventId = event.Id;

          logger.debug("Processing event", {
            eventId,
            subject: event.Subject,
          });

          // Transform to HubSpot properties
          const properties: Record<string, any> = {
            hs_meeting_title: event.Subject || "Untitled Meeting",
            hs_meeting_body: event.Description || "",
            hs_meeting_location: event.Location || "",
            hs_meeting_start_time: event.StartDateTime
              ? new Date(event.StartDateTime).getTime()
              : undefined,
            hs_meeting_end_time: event.EndDateTime
              ? new Date(event.EndDateTime).getTime()
              : undefined,
          };

          // Map owner
          if (event.OwnerId) {
            const hsOwnerId = ownerMapper.getHubSpotOwnerId(event.OwnerId);
            if (hsOwnerId) {
              properties.hubspot_owner_id = hsOwnerId;
            }
          }

          // Create meeting in HubSpot
          const meetingId = await hubspotLoader.createMeeting(properties);

          logger.info("Created meeting in HubSpot", {
            salesforceEventId: eventId,
            hubspotMeetingId: meetingId,
          });

          // Create associations
          const associations = [];

          // Associate to Contact (WhoId)
          if (event.WhoId) {
            const contactMapping = idMappingCache.get(event.WhoId);
            if (contactMapping && contactMapping.hubspot_type === "contact") {
              associations.push({
                toObjectType: "contacts",
                toObjectId: contactMapping.hubspot_id,
                associationTypeId: 200,
              });
            } else {
              logger.warn("Contact mapping not found for WhoId", {
                whoId: event.WhoId,
                eventId,
              });
            }
          }

          // Associate to Company/Deal (WhatId)
          if (event.WhatId) {
            const whatMapping = idMappingCache.get(event.WhatId);
            if (whatMapping) {
              if (whatMapping.hubspot_type === "company") {
                associations.push({
                  toObjectType: "companies",
                  toObjectId: whatMapping.hubspot_id,
                  associationTypeId: 182,
                });
              } else if (whatMapping.hubspot_type === "deal") {
                associations.push({
                  toObjectType: "deals",
                  toObjectId: whatMapping.hubspot_id,
                  associationTypeId: 206,
                });
              }
            } else {
              logger.warn("WhatId mapping not found", {
                whatId: event.WhatId,
                eventId,
              });
            }
          }

          // Create all associations
          for (const assoc of associations) {
            try {
              await hubspotLoader.createEngagementAssociation(
                "meetings",
                meetingId,
                assoc.toObjectType,
                assoc.toObjectId,
                assoc.associationTypeId,
              );
              logger.debug("Created association", {
                meetingId,
                toObjectType: assoc.toObjectType,
                toObjectId: assoc.toObjectId,
              });
            } catch (error: any) {
              logger.error("Failed to create association", {
                error: error.message,
                meetingId,
                association: assoc,
              });
              // Don't fail the whole migration for association errors
            }
          }

          // Store ID mapping
          await database.createIdMapping(
            this.runId,
            eventId,
            "Event",
            meetingId,
            "meeting",
          );

          successCount++;
        } catch (error: any) {
          logger.error("Failed to migrate event", {
            eventId: event.Id,
            error: error.message,
          });

          await database.createMigrationError(
            this.runId,
            objectType,
            event.Id,
            "Event",
            `Failed to migrate: ${error.message}`,
          );

          failedCount++;
        }
      }

      // Update progress
      processedCount += recordsToProcess.length;
      lastId = extractResult.nextPage;
      hasMore =
        extractResult.hasMore &&
        (!testMode || processedCount < testModeLimit);

      await database.updateMigrationProgress(this.runId, objectType, {
        processed_records: processedCount,
        last_sf_id_processed: lastId,
      });

      logger.info(
        `Progress: ${processedCount}/${recordsToMigrate} Events processed (${successCount} successful, ${failedCount} failed)`,
      );
    }

    // Update final counts
    await database.updateMigrationProgress(this.runId, objectType, {
      status: "completed",
      completed_at: new Date(),
      failed_records: failedCount,
    });

    await database.createAuditLog(
      this.runId,
      "object_migration_completed",
      objectType,
      processedCount,
      {
        successCount,
        failedCount,
      },
    );

    logger.info(
      `✅ Completed Event to Meeting migration: ${processedCount} records processed (${successCount} successful, ${failedCount} failed)`,
    );
  } catch (error: any) {
    logger.error("❌ Failed to migrate Events to Meetings", {
      error: error.message,
    });

    await database.updateMigrationProgress(this.runId, objectType, {
      status: "failed",
      completed_at: new Date(),
    });

    throw error;
  }
}
```

---

### Phase 3: Call Task to Call Migration (Day 4)

**Migration Type:** `call_to_call_migration`

**Field Mappings:**

| Salesforce Field | HubSpot Property | Transformation |
|-----------------|------------------|----------------|
| Subject | hs_call_title | Direct |
| Description | hs_call_body | Direct |
| ActivityDate | hs_timestamp | Convert to Unix timestamp (ms) |
| CallDurationInSeconds | hs_call_duration | Convert seconds to milliseconds |
| CallType | hs_call_direction | Map: "Inbound"→"INBOUND", "Outbound"→"OUTBOUND" |
| CallDisposition | hs_call_disposition | Direct |
| OwnerId | hubspot_owner_id | Lookup via owner mapper |

**Association Type IDs:**
- Call → Contact: 194
- Call → Company: 182
- Call → Deal: 206

**Implementation:** Similar to Event migration pattern

---

### Phase 4: EmailMessage to Email Migration (Day 5)

**Migration Type:** `emailmessage_to_email_migration`

**Field Mappings:**

| Salesforce Field | HubSpot Property | Transformation |
|-----------------|------------------|----------------|
| Subject | hs_email_subject | Direct |
| TextBody | hs_email_text | Direct |
| HtmlBody | hs_email_html | Direct |
| FromAddress | hs_email_from_email | Direct |
| ToAddress | hs_email_to_email | Direct (first address if multiple) |
| MessageDate | hs_timestamp | Convert to Unix timestamp (ms) |
| Incoming | hs_email_direction | Map: true→"EMAIL", false→"FORWARD" |
| Status | hs_email_status | Map to SENT, BOUNCED, etc. |

**Association Handling:**
- RelatedToId → Account/Opportunity (WhatId equivalent)
- ParentId → Contact/Lead (WhoId equivalent)

**Association Type IDs:**
- Email → Contact: 198
- Email → Company: 182
- Email → Deal: 206

**Implementation:** Similar pattern with HTML/text body handling

---

### Phase 5: Email Task to Email Migration (Day 6)

**Migration Type:** `emailtask_to_email_migration`

**Field Mappings:**

| Salesforce Field | HubSpot Property | Transformation |
|-----------------|------------------|----------------|
| Subject | hs_email_subject | Direct |
| Description | hs_email_text | Direct (no HTML body) |
| ActivityDate | hs_timestamp | Convert to Unix timestamp (ms) |
| Status | hs_email_status | Default to "SENT" |
| OwnerId | hubspot_owner_id | Lookup via owner mapper |

**Note:** Email Tasks don't have From/To addresses or HTML content - they're activity logs only.

**Association Type IDs:** Same as EmailMessage

---

### Phase 6: Dashboard Integration (Day 7)

#### Update Migration Page

**File:** `dashboard/app/migrate/page.tsx`

**Add Migration Types:**
```typescript
type MigrationType =
  | "account_to_company"
  | "opportunity_renewal_associations"
  | "pilot_opportunity_associations"
  | "event_to_meeting_migration"
  | "call_to_call_migration"
  | "emailmessage_to_email_migration"
  | "emailtask_to_email_migration";
```

**Add UI Buttons:**

```tsx
<button
  onClick={() => {
    setMigrationType("event_to_meeting_migration");
    setStep("preview");
  }}
  className="w-full rounded-lg border-2 border-border bg-background p-6 text-left transition-all hover:border-primary/50 hover:bg-primary/5"
>
  <h3 className="text-lg font-semibold">
    Events to Meetings
  </h3>
  <p className="mt-1 text-sm text-muted-foreground">
    Migrate Salesforce Events (calendar appointments) to HubSpot Meetings
    with associations to contacts, companies, and deals
  </p>
</button>

<button
  onClick={() => {
    setMigrationType("call_to_call_migration");
    setStep("preview");
  }}
  className="w-full rounded-lg border-2 border-border bg-background p-6 text-left transition-all hover:border-primary/50 hover:bg-primary/5"
>
  <h3 className="text-lg font-semibold">
    Call Tasks to Calls
  </h3>
  <p className="mt-1 text-sm text-muted-foreground">
    Migrate Salesforce Call Tasks to HubSpot Calls with duration,
    call type, and associations
  </p>
</button>

<button
  onClick={() => {
    setMigrationType("emailmessage_to_email_migration");
    setStep("preview");
  }}
  className="w-full rounded-lg border-2 border-border bg-background p-6 text-left transition-all hover:border-primary/50 hover:bg-primary/5"
>
  <h3 className="text-lg font-semibold">
    Email Messages to Emails
  </h3>
  <p className="mt-1 text-sm text-muted-foreground">
    Migrate Salesforce EmailMessages (rich content) to HubSpot Emails
    with HTML/text body and associations
  </p>
</button>

<button
  onClick={() => {
    setMigrationType("emailtask_to_email_migration");
    setStep("preview");
  }}
  className="w-full rounded-lg border-2 border-border bg-background p-6 text-left transition-all hover:border-primary/50 hover:bg-primary/5"
>
  <h3 className="text-lg font-semibold">
    Email Tasks to Emails
  </h3>
  <p className="mt-1 text-sm text-muted-foreground">
    Migrate Salesforce Email Activity Tasks to HubSpot Emails
    (activity logs without HTML content)
  </p>
</button>
```

#### Update getMigrationTypeName()

```typescript
function getMigrationTypeName(type: MigrationType): string {
  switch (type) {
    case "account_to_company":
      return "Account to Company migration";
    case "opportunity_renewal_associations":
      return "Opportunity Renewal Associations migration";
    case "pilot_opportunity_associations":
      return "Pilot Opportunity Associations migration";
    case "event_to_meeting_migration":
      return "Event to Meeting migration";
    case "call_to_call_migration":
      return "Call to Call migration";
    case "emailmessage_to_email_migration":
      return "EmailMessage to Email migration";
    case "emailtask_to_email_migration":
      return "Email Task to Email migration";
    default:
      return "Migration";
  }
}
```

#### Update MigrationPreview Component

**File:** `dashboard/components/MigrationPreview.tsx`

Add preview logic for activity migrations (similar to association migrations - no field mappings needed).

---

### Phase 7: Testing (Day 8)

#### Test Plan

**1. Unit Tests**
- Test bulk ID mapping lookup
- Test field transformations
- Test association creation

**2. Integration Tests**
- Test with 5 records in test mode
- Verify associations created correctly
- Check error handling

**3. Performance Tests**
- Test with 100 records
- Measure processing time
- Verify rate limiting works

**4. End-to-End Tests**
- Run full migration for each type
- Verify dashboard shows progress
- Check data accuracy in HubSpot

#### Test Checklist

- [ ] Events create meetings with correct date/time
- [ ] Meetings associated to contacts
- [ ] Meetings associated to companies/deals
- [ ] Calls have correct duration
- [ ] EmailMessages have HTML/text body
- [ ] Email Tasks logged correctly
- [ ] Owner mapping works
- [ ] Progress tracking accurate
- [ ] Error handling works
- [ ] Failed records logged properly

---

## Data Migration Order

**Recommended sequence:**

1. **Events → Meetings** (Simplest, validates foundation)
2. **Calls → Calls** (Similar to Events, adds duration handling)
3. **EmailMessages → Emails** (Complex - HTML/text, threading)
4. **Email Tasks → Emails** (Simplest email variant)

**Rationale:**
- Start simple to validate architecture
- Build confidence before tackling complex migrations
- Each migration informs the next

---

## Performance Estimates

### Processing Speed

**Per Activity:**
- Extract from Salesforce: ~5ms
- Transform: ~1ms
- Create in HubSpot: ~100ms
- Create associations (avg 2): ~200ms
- Store ID mapping: ~10ms

**Total per activity:** ~316ms

**With rate limiting (8 req/sec):**
- Theoretical: ~19 activities/second = ~1,140/minute
- Practical (with batching): ~100-150/minute
- Conservative estimate: **100 activities/minute**

### Total Migration Time

| Activity Type | Records | Time @ 100/min | Time @ 150/min |
|--------------|---------|----------------|----------------|
| Events → Meetings | 1,560 | 16 minutes | 10 minutes |
| Calls → Calls | ~500* | 5 minutes | 3 minutes |
| EmailMessages | 1,587 | 16 minutes | 11 minutes |
| Email Tasks | 3,876 | 39 minutes | 26 minutes |
| **Total** | **~7,500** | **76 minutes** | **50 minutes** |

*Estimated based on typical Task distribution

**Total migration time: ~1-1.5 hours** (excluding test mode runs)

---

## Risk Assessment

### High Risks

**1. API Rate Limiting**
- **Risk:** HubSpot rate limit (100 req/10sec) exceeded
- **Mitigation:** Built-in rate limiter, retry logic
- **Impact:** Medium - Slows migration but doesn't fail it

**2. Missing Associations**
- **Risk:** WhoId/WhatId not found in ID mappings
- **Mitigation:** Log warnings, continue processing
- **Impact:** Low - Activities created but not linked

**3. Data Quality**
- **Risk:** Null subjects, invalid dates
- **Mitigation:** Validation, default values
- **Impact:** Low - Some records skipped

### Medium Risks

**4. HTML Email Rendering**
- **Risk:** HubSpot renders HTML differently than Salesforce
- **Mitigation:** Store original HTML, log issues
- **Impact:** Low - Cosmetic only

**5. Owner Mapping Gaps**
- **Risk:** Salesforce owner not in HubSpot
- **Mitigation:** Owner mapper with fallback logic
- **Impact:** Low - Activities created without owner

### Low Risks

**6. Timezone Handling**
- **Risk:** DateTime conversion issues
- **Mitigation:** Use Unix timestamps (UTC)
- **Impact:** Very Low - Standard approach

---

## Success Criteria

### Must Have

✅ All 4 activity types implemented
✅ Associations created correctly
✅ Progress tracking works
✅ Error handling robust
✅ Dashboard UI complete
✅ Test mode works

### Should Have

✅ Processing speed >100/minute
✅ <5% error rate
✅ Bulk ID mapping cache works
✅ Owner mapping success >90%

### Nice to Have

✅ Processing speed >150/minute
✅ <1% error rate
✅ Detailed error categorization
✅ Retry failed records functionality

---

## Rollout Plan

### Pre-Migration

1. **Backup HubSpot data** (export current activities)
2. **Create test sandbox** (if available)
3. **Run with testModeLimit=5** for each type
4. **Validate sample data** in HubSpot
5. **Review error logs**

### Migration Execution

**Phase 1: Pilot (Day 1)**
- Run Events migration with testMode=100
- Validate associations manually
- Adjust if needed

**Phase 2: Events Full (Day 1)**
- Run full Events migration
- Monitor progress in dashboard
- Review errors

**Phase 3: Calls (Day 2)**
- Test mode: 50 records
- Full migration if successful

**Phase 4: Emails (Day 3-4)**
- EmailMessages first (rich data)
- Email Tasks second (simple logs)
- Monitor for HTML rendering issues

### Post-Migration

1. **Validate record counts** (Salesforce vs HubSpot)
2. **Spot check associations** (random sampling)
3. **Review error log** for patterns
4. **Document issues** and resolutions
5. **Plan retry** for failed records (if any)

---

## Monitoring & Troubleshooting

### Key Metrics to Watch

**During Migration:**
- Processed records count
- Success vs failed ratio
- Processing speed (records/minute)
- API error rate
- Association success rate

**Dashboard Monitoring:**
- `migration_progress` table
- `migration_errors` table
- Real-time updates via Supabase Realtime

### Common Issues & Solutions

**Issue 1: Rate Limit Exceeded**
```
Error: Rate limit exceeded
Solution: Retry logic handles this automatically
Action: Monitor - should resolve itself
```

**Issue 2: Association Not Found**
```
Warning: Contact mapping not found for WhoId
Solution: Activity created but not linked
Action: Run association repair script post-migration
```

**Issue 3: Invalid DateTime**
```
Error: Invalid timestamp for hs_meeting_start_time
Solution: Validation added, uses current time as fallback
Action: Review Salesforce data quality
```

**Issue 4: Duplicate Records**
```
Error: Meeting with this Salesforce ID already exists
Solution: Check id_mappings table first
Action: Add deduplication logic if needed
```

### Debug Tools

**1. Check Event Sample:**
```bash
cd worker && npx tsx check-events.ts
```

**2. Check ID Mappings:**
```sql
SELECT COUNT(*), hubspot_type
FROM id_mappings
GROUP BY hubspot_type;
```

**3. Check Failed Records:**
```sql
SELECT * FROM migration_errors
WHERE run_id = '[run-id]'
ORDER BY created_at DESC;
```

---

## Database Schema Reference

### Existing Tables (No Changes Needed!)

**migration_runs:**
```sql
- id (uuid)
- status (enum: queued, running, completed, failed)
- config_snapshot (jsonb)
- notes (text)
- created_at, started_at, completed_at
```

**migration_progress:**
```sql
- id (uuid)
- run_id (uuid)
- object_type (enum) -- 'activities' already exists!
- total_records (int)
- processed_records (int)
- failed_records (int)
- status (enum)
- created_at, updated_at
```

**id_mappings:**
```sql
- id (uuid)
- run_id (uuid)
- salesforce_id (text)
- salesforce_type (text) -- 'Event', 'EmailMessage', 'Task'
- hubspot_id (text)
- hubspot_type (text) -- 'meeting', 'email', 'call'
- migrated_at (timestamp)
- metadata (jsonb)
```

**migration_errors:**
```sql
- id (uuid)
- run_id (uuid)
- salesforce_id (text)
- salesforce_type (text)
- object_type (enum)
- error_message (text)
- error_details (jsonb)
- retry_count (int)
- status (enum)
- created_at, resolved_at
```

---

## Appendix A: HubSpot Association Type IDs

### Engagements to CRM Objects

| From | To | Type | Association Type ID |
|------|-----|------|-------------------|
| Meeting | Contact | HUBSPOT_DEFINED | 200 |
| Meeting | Company | HUBSPOT_DEFINED | 182 |
| Meeting | Deal | HUBSPOT_DEFINED | 206 |
| Email | Contact | HUBSPOT_DEFINED | 198 |
| Email | Company | HUBSPOT_DEFINED | 182 |
| Email | Deal | HUBSPOT_DEFINED | 206 |
| Call | Contact | HUBSPOT_DEFINED | 194 |
| Call | Company | HUBSPOT_DEFINED | 182 |
| Call | Deal | HUBSPOT_DEFINED | 206 |

### Reference

These are standard HubSpot association types that don't require custom label creation.

---

## Appendix B: Salesforce Object Specifications

### Event Object

**API Name:** Event
**Label:** Event
**Record Count:** 1,560

**Key Fields:**
- Id, Subject, Description, Location
- StartDateTime, EndDateTime, DurationInMinutes
- IsAllDayEvent, IsRecurrence
- WhoId (Contact/Lead)
- WhatId (Account/Opportunity/Campaign/Custom)
- OwnerId, CreatedDate, LastModifiedDate

**Relationship Pattern:**
- WhoId: Person (Contact, Lead)
- WhatId: Business Object (Account, Opportunity)

### EmailMessage Object

**API Name:** EmailMessage
**Label:** Email Message
**Record Count:** 1,587

**Key Fields:**
- Id, Subject, TextBody, HtmlBody
- FromAddress, ToAddress, CcAddress, BccAddress
- MessageDate, Status, Incoming
- RelatedToId (WhatId equivalent)
- ParentId (WhoId equivalent)
- ActivityId (related Task)

**Relationship Pattern:**
- ParentId: Person (Contact, Lead)
- RelatedToId: Business Object (Account, Opportunity, Case)

### Task Object (Email & Call Types)

**API Name:** Task
**Label:** Task
**Email Tasks:** 3,876
**Call Tasks:** ~500 (estimated)

**Key Fields:**
- Id, Subject, Description
- ActivityDate, Status, Priority
- Type ('Email' or 'Call')
- TaskSubtype ('Email')
- CallDurationInSeconds, CallType, CallDisposition
- WhoId (Contact/Lead)
- WhatId (Account/Opportunity)
- OwnerId

**Relationship Pattern:**
- WhoId: Person (Contact, Lead)
- WhatId: Business Object (Account, Opportunity)

---

## Appendix C: HubSpot Engagement Properties

### Meeting Properties

**Required:**
- hs_meeting_title (string)

**Optional:**
- hs_meeting_body (string)
- hs_meeting_location (string)
- hs_meeting_start_time (timestamp ms)
- hs_meeting_end_time (timestamp ms)
- hubspot_owner_id (number)

### Email Properties

**Required:**
- hs_email_subject (string)

**Optional:**
- hs_email_text (string)
- hs_email_html (string)
- hs_email_from_email (string)
- hs_email_to_email (string)
- hs_email_direction (enum: EMAIL, FORWARD, etc.)
- hs_email_status (enum: SENT, BOUNCED, etc.)
- hs_timestamp (timestamp ms)
- hubspot_owner_id (number)

### Call Properties

**Required:**
- hs_call_title (string)

**Optional:**
- hs_call_body (string)
- hs_call_duration (number ms)
- hs_call_direction (enum: INBOUND, OUTBOUND)
- hs_call_disposition (string)
- hs_timestamp (timestamp ms)
- hubspot_owner_id (number)

---

## Appendix D: Code File Structure

### Files to Create/Modify

**New Files:** None! (All changes to existing files)

**Modified Files:**
1. `worker/src/services/database.ts` - Add bulkGetIdMappings()
2. `worker/src/loaders/hubspot.ts` - Add createMeeting(), createEmail(), createCall(), createEngagementAssociation()
3. `worker/src/extractors/salesforce.ts` - Add extractEvents(), extractEmailMessages(), extractEmailTasks(), extractCallTasks()
4. `worker/src/services/migrator.ts` - Add 4 migration methods
5. `dashboard/app/migrate/page.tsx` - Add 4 migration type buttons
6. `dashboard/components/MigrationPreview.tsx` - Add activity preview logic

**Total Lines of Code:** ~1,500-2,000 (mostly similar patterns)

---

## Conclusion

This comprehensive plan provides a structured approach to migrating all Salesforce activities to HubSpot with full association tracking and robust error handling.

### Key Highlights

✅ **Zero Database Changes** - Uses existing schema
✅ **Performance Optimized** - Bulk ID mapping cache eliminates bottlenecks
✅ **Robust Error Handling** - Continues processing even with failed associations
✅ **Full Progress Tracking** - Real-time dashboard monitoring
✅ **Production Ready** - Rate limiting, retry logic, logging

### Expected Outcomes

- **~7,500 activities migrated** in ~1-1.5 hours
- **Full association tracking** to contacts, companies, deals
- **<5% error rate** (typical for data migrations)
- **Complete audit trail** in database

### Next Steps

1. **Review this document** (tomorrow)
2. **Approve implementation plan**
3. **Begin Phase 1** (Foundation Layer)
4. **Proceed sequentially** through phases

---

**Document Version:** 1.0
**Last Updated:** 2025-11-05
**Status:** Ready for Review
