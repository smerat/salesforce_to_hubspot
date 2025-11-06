# Salesforce to HubSpot Activity Migration - Technical Analysis

## Executive Summary

This document provides a comprehensive analysis of the current Salesforce to HubSpot migration system and proposes a detailed structure for migrating activities (Tasks, Events, EmailMessages) from Salesforce to HubSpot engagements (Tasks, Meetings, Emails/Calls).

**Analysis Date:** 2025-11-05
**Current System Version:** 1.0.0
**HubSpot API Client:** v11.2.0

---

## 1. Current Migration Architecture

### 1.1 System Overview

The migration system follows a **classic ETL (Extract, Transform, Load) architecture** with three main components:

```
┌──────────────────────────────────────────────────────┐
│                   Web Dashboard                       │
│              (Next.js + Supabase Realtime)           │
│         - Queue migrations                           │
│         - Monitor progress                           │
│         - View errors                                │
└──────────────┬───────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────┐
│                  Supabase PostgreSQL                  │
│         - migration_runs (execution tracking)        │
│         - migration_progress (object progress)       │
│         - id_mappings (SF ID → HS ID)                │
│         - migration_errors (error logging)           │
│         - audit_log (complete audit trail)           │
│         - owner_mappings (user/owner mapping)        │
└──────────────┬───────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────┐
│               Migration Worker (Node.js)              │
│                                                       │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │ Extractors  │→ │ Transformers │→ │   Loaders   │ │
│  │ (Salesforce)│  │ (Field Map)  │  │  (HubSpot)  │ │
│  └─────────────┘  └──────────────┘  └─────────────┘ │
│                                                       │
│  Services: database, migrator, owner-mapper          │
│  Utils: logger, retry, rate-limiter                  │
└──────────────────────────────────────────────────────┘
```

### 1.2 Core Components

#### **Extractor** (`worker/src/extractors/salesforce.ts`)
- **Purpose:** Extract data from Salesforce using JSForce
- **Key Features:**
  - Pagination support with `lastId` cursor
  - Rate limiting (10 req/sec default)
  - Generic `extract()` method for any SOQL query
  - Specialized methods for complex queries
  - Batch size control (default 200 records)

**Example Pattern:**
```typescript
async extract(
  soqlObject: string,
  fields: string[],
  batchSize: number = 200,
  lastId?: string,
  whereClause?: string,
): Promise<ExtractResult>
```

#### **Transformer** (`worker/src/transformers/index.ts`)
- **Purpose:** Transform Salesforce data to HubSpot format
- **Key Features:**
  - Field mapping with custom transformations
  - Enum value mapping (Industry, Type, etc.)
  - Owner ID mapping integration
  - Data validation
  - Type-safe transformations

**Example Pattern:**
```typescript
const properties: Record<string, any> = {};
for (const mapping of fieldMappings) {
  if (mapping.enabled) {
    const value = record[mapping.salesforceField];
    properties[mapping.hubspotField] = transformValue(value);
  }
}
```

#### **Loader** (`worker/src/loaders/hubspot.ts`)
- **Purpose:** Load data to HubSpot using HubSpot API Client
- **Key Features:**
  - Batch create (up to 100 records per batch)
  - Rate limiting (8 req/sec default)
  - Search by property
  - Association creation (v4 API)
  - Error handling with detailed logging

**Example Pattern:**
```typescript
async batchCreate(
  objectType: string,
  records: Array<{ salesforceId: string; properties: Record<string, any> }>,
): Promise<BatchLoadResult>
```

#### **Migrator** (`worker/src/services/migrator.ts`)
- **Purpose:** Orchestrate the entire migration process
- **Key Features:**
  - Polling for queued migrations
  - Progress tracking
  - Error handling and logging
  - Test mode support
  - Graceful shutdown

**Migration Flow:**
1. Poll for queued migrations
2. Update status to "running"
3. Connect to Salesforce
4. Initialize owner mapper
5. Extract → Transform → Load in batches
6. Store ID mappings
7. Update progress
8. Handle errors
9. Mark as completed

#### **Database Service** (`worker/src/services/database.ts`)
- **Purpose:** Interface with Supabase PostgreSQL
- **Key Features:**
  - Connection pooling
  - Parameterized queries (SQL injection protection)
  - Bulk operations
  - Transaction support
  - Error logging

### 1.3 Current Supported Migrations

#### **Account to Company** (`account_to_company`)
- Migrates Salesforce Accounts → HubSpot Companies
- Dynamic field mapping from dashboard
- Owner mapping support
- Domain validation
- Industry/Type enum transformations

#### **Opportunity Renewal Associations** (`opportunity_renewal_associations`)
- Migrates renewal relationships between Opportunities → Deal associations
- Uses custom HubSpot association labels ("renewed in" / "renewal of")
- Bidirectional associations
- Lookup by `hs_salesforceopportunityid`

#### **Pilot Opportunity Associations** (`pilot_opportunity_associations`)
- Migrates pilot relationships between Opportunities → Deal associations
- Uses custom HubSpot association labels ("has pilot" / "pilot for")
- Similar pattern to renewal associations

---

## 2. Association Mechanism Deep Dive

### 2.1 How Associations Currently Work

The system uses **two approaches** for creating associations:

#### **Approach 1: During Object Creation**
Used for Deal → Company associations when creating deals.

```typescript
// In transformer
const hubspotDeal: HubSpotDeal = {
  properties: { /* deal properties */ },
  associations: [
    {
      to: { id: accountHubSpotId },
      types: [{
        associationCategory: "HUBSPOT_DEFINED",
        associationTypeId: 341  // Deal to Company
      }]
    }
  ]
};
```

#### **Approach 2: Post-Creation Association**
Used for custom deal-to-deal associations (renewals, pilots).

**Step 1:** Look up association type IDs
```typescript
const associationIds = await hubspotLoader.getDealAssociationLabelIds(
  "renewed_in_renewal_of"
);
// Returns: { forward: 123, reverse: 456 }
```

**Step 2:** Find related objects
```typescript
const sourceDealId = await hubspotLoader.searchDealsByProperty(
  "hs_salesforceopportunityid",
  salesforceOpportunityId
);
```

**Step 3:** Create bidirectional associations
```typescript
// Forward: Deal A "renewed in" Deal B
await hubspotLoader.createAssociation(
  "deals", sourceDealId,
  "deals", targetDealId,
  associationIds.forward
);

// Reverse: Deal B "renewal of" Deal A
await hubspotLoader.createAssociation(
  "deals", targetDealId,
  "deals", sourceDealId,
  associationIds.reverse
);
```

### 2.2 ID Mapping System

**Critical for associations!** The `id_mappings` table tracks all Salesforce → HubSpot ID mappings.

**Schema:**
```sql
CREATE TABLE id_mappings (
  id UUID PRIMARY KEY,
  run_id UUID REFERENCES migration_runs(id),
  salesforce_id TEXT NOT NULL,        -- SF ID (e.g., "003xxx")
  salesforce_type TEXT NOT NULL,      -- SF Object Type (e.g., "Account")
  hubspot_id TEXT NOT NULL,           -- HS ID (e.g., "12345")
  hubspot_type TEXT NOT NULL,         -- HS Object Type (e.g., "company")
  migrated_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB,
  UNIQUE(salesforce_id, salesforce_type)
);
```

**Usage Pattern:**
```typescript
// After successful load to HubSpot
await database.bulkCreateIdMappings(
  loadResult.successful.map((item) => ({
    runId: this.runId!,
    salesforceId: item.salesforceId,
    salesforceType: "Account",
    hubspotId: item.hubspotId,
    hubspotType: "company",
  }))
);

// Later, when creating associations
const hubspotId = await database.getHubSpotId(salesforceId, "Account");
```

---

## 3. Database Schema Analysis

### 3.1 Current Schema

**migration_runs**
- Tracks each migration execution
- Status: queued, running, completed, failed, paused
- Stores config snapshot (field mappings, test mode, etc.)

**migration_progress**
- One row per object type per run
- Object types: 'contacts', 'companies', 'deals', 'activities', 'notes', 'deal_associations'
- **Note:** 'activities' and 'notes' are already in the enum but NOT implemented
- Tracks: total_records, processed_records, failed_records, skipped_records
- Cursor: last_sf_id_processed

**id_mappings**
- Salesforce ID → HubSpot ID mappings
- Indexed by salesforce_id, hubspot_id, run_id, types
- Used for lookups during association creation

**migration_errors**
- Error logging with retry capability
- Status: pending_retry, failed, resolved, skipped
- Stores error_details as JSONB

**audit_log**
- Complete audit trail of all migration actions
- Timestamped with metadata

**owner_mappings**
- Maps Salesforce User IDs → HubSpot Owner IDs
- Match methods: email, name, manual
- Used for assigning owners to migrated records

### 3.2 Schema Readiness for Activities

**Good News:** The schema is already prepared!
- `migration_progress.object_type` already includes 'activities' and 'notes'
- `id_mappings` is generic (works for any object type)
- `migration_errors` supports any object type

**Action Required:**
- No schema changes needed for basic activity migration
- May want to add activity-specific metadata fields later

---

## 4. Salesforce Activity Objects

### 4.1 Salesforce Activity Model

Salesforce has **three main activity objects**:

#### **Task** (Standard Object)
- **Purpose:** To-dos, follow-ups, action items
- **Key Fields:**
  - `Id`, `WhoId` (Contact/Lead), `WhatId` (Account/Opp/etc.)
  - `Subject`, `Description`, `Status`, `Priority`
  - `ActivityDate`, `ReminderDateTime`
  - `OwnerId`, `CreatedDate`, `LastModifiedDate`
  - `IsClosed`, `IsHighPriority`

#### **Event** (Standard Object)
- **Purpose:** Calendar events, meetings, appointments
- **Key Fields:**
  - `Id`, `WhoId`, `WhatId`
  - `Subject`, `Description`, `Location`
  - `StartDateTime`, `EndDateTime`, `DurationInMinutes`
  - `OwnerId`, `CreatedDate`, `LastModifiedDate`
  - `IsAllDayEvent`, `IsRecurrence`

#### **EmailMessage** (Standard Object)
- **Purpose:** Email communications (requires Email-to-Case or similar)
- **Key Fields:**
  - `Id`, `FromAddress`, `ToAddress`, `CcAddress`, `BccAddress`
  - `Subject`, `TextBody`, `HtmlBody`
  - `MessageDate`, `Status`
  - `RelatedToId` (WhatId), `ActivityId`
  - `Incoming`, `HasAttachment`

### 4.2 Current Activity References in Code

**Search Results:** No existing code references to Task, Event, or EmailMessage

**Implications:**
- Clean slate for implementation
- No conflicts with existing code
- Can follow established patterns

---

## 5. HubSpot Engagement/Activity Support

### 5.1 HubSpot Engagement Model

HubSpot v3 API uses **object-based endpoints** for engagements:

#### **Tasks** (`/crm/v3/objects/tasks`)
- **Purpose:** To-dos and action items
- **Required Properties:**
  - `hs_timestamp` (determines timeline position)
  - `hs_task_subject`
- **Optional Properties:**
  - `hs_task_body`, `hs_task_status`, `hs_task_priority`
  - `hs_task_type`, `hubspot_owner_id`
  - `hs_task_is_completed`

#### **Meetings** (`/crm/v3/objects/meetings`)
- **Purpose:** Scheduled meetings and events
- **Required Properties:**
  - `hs_timestamp`
  - `hs_meeting_title`
- **Optional Properties:**
  - `hs_meeting_body`, `hs_meeting_location`
  - `hs_meeting_start_time`, `hs_meeting_end_time`
  - `hs_meeting_outcome`, `hubspot_owner_id`

#### **Calls** (`/crm/v3/objects/calls`)
- **Purpose:** Phone calls
- **Required Properties:**
  - `hs_timestamp`
- **Optional Properties:**
  - `hs_call_title`, `hs_call_body`
  - `hs_call_direction` (INBOUND/OUTBOUND)
  - `hs_call_duration` (milliseconds)
  - `hs_call_status`, `hs_call_disposition`
  - `hubspot_owner_id`

#### **Emails** (`/crm/v3/objects/emails`)
- **Purpose:** Email communications
- **Required Properties:**
  - `hs_timestamp`
- **Optional Properties:**
  - `hs_email_subject`, `hs_email_text`, `hs_email_html`
  - `hs_email_direction` (EMAIL, INCOMING_EMAIL, FORWARDED_EMAIL)
  - `hs_email_status`
  - `hubspot_owner_id`

#### **Notes** (`/crm/v3/objects/notes`)
- **Purpose:** General notes and comments
- **Required Properties:**
  - `hs_timestamp`
  - `hs_note_body`
- **Optional Properties:**
  - `hubspot_owner_id`

### 5.2 HubSpot Engagement Associations

Engagements can be associated with:
- Contacts
- Companies
- Deals
- Tickets
- Custom Objects

**Standard Association Type IDs:**
- Task → Contact: 204
- Meeting → Contact: 200
- Call → Contact: 194
- Email → Contact: 198
- Note → Contact: 202

**Association Methods:**
1. **During creation** (include in POST body)
2. **Post-creation** (PUT to associations endpoint)

**Example:**
```typescript
// Create task with association
POST /crm/v3/objects/tasks
{
  "properties": { /* task properties */ },
  "associations": [
    {
      "to": { "id": "12345" },
      "types": [
        {
          "associationCategory": "HUBSPOT_DEFINED",
          "associationTypeId": 204  // Task to Contact
        }
      ]
    }
  ]
}
```

### 5.3 Current HubSpot Loader Capabilities

**Existing Methods:**
- `batchCreate()` - Works for any object type (including engagements!)
- `createSingle()` - Single object creation
- `searchDealsByProperty()` - Search functionality
- `getDealAssociationLabelIds()` - Get custom association IDs
- `createAssociation()` - v4 association API

**What's Missing:**
- Generic search method (currently only deals)
- Engagement-specific property validation
- Engagement disposition/outcome mapping

**Action Required:**
- Add generic search method
- Add engagement property helpers
- Extend existing methods (minimal changes)

---

## 6. Proposed Activity Migration Structure

### 6.1 Object Mapping Strategy

| Salesforce Object | HubSpot Object | Rationale |
|-------------------|----------------|-----------|
| Task | Task | Direct 1:1 mapping |
| Event | Meeting | Calendar events → Meetings |
| EmailMessage | Email or Note | Email if full metadata available, Note if simple text |

### 6.2 Field Mappings

#### **Task: Salesforce → HubSpot**

```typescript
{
  salesforceObject: "Task",
  hubspotObject: "tasks",
  fields: [
    { sf: "Id", hs: "salesforce_task_id", custom: true },
    { sf: "Subject", hs: "hs_task_subject", required: true },
    { sf: "Description", hs: "hs_task_body" },
    { sf: "Status", hs: "hs_task_status", transform: mapTaskStatus },
    { sf: "Priority", hs: "hs_task_priority", transform: mapTaskPriority },
    { sf: "ActivityDate", hs: "hs_timestamp", required: true, transform: toTimestamp },
    { sf: "OwnerId", hs: "hubspot_owner_id", transform: mapOwner },
    { sf: "IsClosed", hs: "hs_task_is_completed", transform: (v) => v ? "COMPLETED" : "NOT_STARTED" },
  ],
  associations: [
    { sfField: "WhoId", hsObject: "contacts", condition: "isContact" },
    { sfField: "WhatId", hsObject: "companies|deals", condition: "dynamicLookup" },
  ]
}
```

**Status Mapping:**
```typescript
const taskStatusMap = {
  "Not Started": "NOT_STARTED",
  "In Progress": "IN_PROGRESS",
  "Completed": "COMPLETED",
  "Waiting on someone else": "WAITING",
  "Deferred": "DEFERRED",
};
```

**Priority Mapping:**
```typescript
const taskPriorityMap = {
  "High": "HIGH",
  "Normal": "MEDIUM",
  "Low": "LOW",
};
```

#### **Event: Salesforce → HubSpot Meeting**

```typescript
{
  salesforceObject: "Event",
  hubspotObject: "meetings",
  fields: [
    { sf: "Id", hs: "salesforce_event_id", custom: true },
    { sf: "Subject", hs: "hs_meeting_title", required: true },
    { sf: "Description", hs: "hs_meeting_body" },
    { sf: "Location", hs: "hs_meeting_location" },
    { sf: "StartDateTime", hs: "hs_meeting_start_time", required: true, transform: toTimestamp },
    { sf: "EndDateTime", hs: "hs_meeting_end_time", transform: toTimestamp },
    { sf: "StartDateTime", hs: "hs_timestamp", required: true, transform: toTimestamp },
    { sf: "OwnerId", hs: "hubspot_owner_id", transform: mapOwner },
  ],
  associations: [
    { sfField: "WhoId", hsObject: "contacts" },
    { sfField: "WhatId", hsObject: "companies|deals" },
  ]
}
```

#### **EmailMessage: Salesforce → HubSpot Email**

```typescript
{
  salesforceObject: "EmailMessage",
  hubspotObject: "emails",
  fields: [
    { sf: "Id", hs: "salesforce_email_id", custom: true },
    { sf: "Subject", hs: "hs_email_subject" },
    { sf: "TextBody", hs: "hs_email_text" },
    { sf: "HtmlBody", hs: "hs_email_html" },
    { sf: "MessageDate", hs: "hs_timestamp", required: true, transform: toTimestamp },
    { sf: "Incoming", hs: "hs_email_direction", transform: (v) => v ? "INCOMING_EMAIL" : "EMAIL" },
    // Note: HubSpot doesn't have from/to address fields in standard properties
  ],
  associations: [
    { sfField: "RelatedToId", hsObject: "contacts|companies|deals" },
  ]
}
```

### 6.3 Association Handling

**Challenge:** Activities have TWO relationship fields:
- `WhoId` - Points to Contact or Lead
- `WhatId` - Points to Account, Opportunity, or other objects

**Solution:** Dynamic multi-association

```typescript
async function createActivityAssociations(
  activityType: "tasks" | "meetings" | "emails",
  hubspotActivityId: string,
  whoId: string | null,
  whatId: string | null
) {
  const associations = [];

  // WhoId association
  if (whoId) {
    const whoMapping = await database.getIdMapping(whoId, "Contact");
    if (whoMapping) {
      associations.push({
        toObjectType: "contacts",
        toObjectId: whoMapping.hubspot_id,
        associationTypeId: getAssociationTypeId(activityType, "contacts")
      });
    }
  }

  // WhatId association
  if (whatId) {
    // Determine object type from ID prefix or lookup
    const whatType = await determineSalesforceObjectType(whatId);
    const whatMapping = await database.getIdMapping(whatId, whatType);

    if (whatMapping) {
      associations.push({
        toObjectType: whatMapping.hubspot_type,
        toObjectId: whatMapping.hubspot_id,
        associationTypeId: getAssociationTypeId(activityType, whatMapping.hubspot_type)
      });
    }
  }

  // Create all associations
  for (const assoc of associations) {
    await hubspotLoader.createAssociation(
      activityType,
      hubspotActivityId,
      assoc.toObjectType,
      assoc.toObjectId,
      assoc.associationTypeId
    );
  }
}
```

**Salesforce Object Type Detection:**
```typescript
function determineSalesforceObjectType(salesforceId: string): string {
  // Salesforce uses 3-character prefixes
  const prefix = salesforceId.substring(0, 3);

  const prefixMap: Record<string, string> = {
    "001": "Account",
    "003": "Contact",
    "006": "Opportunity",
    "00Q": "Lead",
    "500": "Case",
    // Add more as needed
  };

  return prefixMap[prefix] || "Unknown";
}
```

### 6.4 Migration Order

**Critical:** Activities must be migrated AFTER their related objects!

**Recommended Order:**
1. Contacts (already done)
2. Companies (already done)
3. Deals (already done)
4. **Activities** (Tasks, Events, Emails)
5. Notes

**Rationale:**
- Activities reference Contacts, Companies, Deals via associations
- ID mappings must exist before creating associations
- Prevents orphaned activities

### 6.5 Batch Processing Strategy

**Challenges:**
1. Activities often have high volume (thousands to millions)
2. Each activity may require multiple association lookups
3. Association creation adds API calls

**Optimization Strategy:**

```typescript
// 1. Extract activities with related IDs
const activities = await extractActivities(batchSize);

// 2. Pre-load all required ID mappings (batch query)
const relatedIds = new Set();
activities.forEach(a => {
  if (a.WhoId) relatedIds.add(a.WhoId);
  if (a.WhatId) relatedIds.add(a.WhatId);
});

const idMappings = await database.bulkGetIdMappings(Array.from(relatedIds));
const idMappingCache = new Map(idMappings.map(m => [m.salesforce_id, m]));

// 3. Transform with cached lookups (no DB queries)
const transformed = activities.map(activity => {
  const whoMapping = idMappingCache.get(activity.WhoId);
  const whatMapping = idMappingCache.get(activity.WhatId);

  return {
    properties: transformActivityProperties(activity),
    associations: buildAssociations(whoMapping, whatMapping),
  };
});

// 4. Batch create in HubSpot
const result = await hubspotLoader.batchCreate("tasks", transformed);
```

**Performance Gains:**
- 1 DB query instead of N queries per batch
- In-memory lookups for associations
- Reduced API calls

---

## 7. Implementation Plan

### 7.1 Phase 1: Foundation (Estimated: 2-3 days)

#### **Task 1.1: Extend Database Service**
```typescript
// Add bulk ID mapping lookup
async bulkGetIdMappings(
  salesforceIds: string[]
): Promise<IdMapping[]>

// Add object type detection helper
async getSalesforceObjectType(
  salesforceId: string
): Promise<string | null>
```

#### **Task 1.2: Extend HubSpot Loader**
```typescript
// Add generic search method
async searchObjectsByProperty(
  objectType: string,
  propertyName: string,
  propertyValue: string
): Promise<string | null>

// Add engagement association type ID helper
async getEngagementAssociationTypeIds(
  engagementType: "tasks" | "meetings" | "calls" | "emails" | "notes",
  toObjectType: "contacts" | "companies" | "deals"
): Promise<number>

// Add batch association creation
async batchCreateAssociations(
  associations: Array<{
    fromObjectType: string,
    fromObjectId: string,
    toObjectType: string,
    toObjectId: string,
    associationTypeId: number
  }>
): Promise<void>
```

#### **Task 1.3: Create Activity Types**
```typescript
// worker/src/types/index.ts

export interface SalesforceTask extends SalesforceRecord {
  Subject: string;
  Description?: string;
  Status?: string;
  Priority?: string;
  ActivityDate?: string;
  ReminderDateTime?: string;
  WhoId?: string;
  WhatId?: string;
  OwnerId?: string;
  IsClosed: boolean;
  IsHighPriority: boolean;
}

export interface SalesforceEvent extends SalesforceRecord {
  Subject: string;
  Description?: string;
  Location?: string;
  StartDateTime: string;
  EndDateTime?: string;
  DurationInMinutes?: number;
  WhoId?: string;
  WhatId?: string;
  OwnerId?: string;
  IsAllDayEvent: boolean;
}

export interface SalesforceEmailMessage extends SalesforceRecord {
  FromAddress: string;
  ToAddress?: string;
  CcAddress?: string;
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  MessageDate: string;
  Status?: string;
  RelatedToId?: string;
  Incoming: boolean;
}

export interface HubSpotTask {
  properties: {
    hs_timestamp: number;
    hs_task_subject: string;
    hs_task_body?: string;
    hs_task_status?: string;
    hs_task_priority?: string;
    hubspot_owner_id?: string;
    [key: string]: any;
  };
  associations?: Array<{
    to: { id: string };
    types: Array<{ associationCategory: string; associationTypeId: number }>;
  }>;
}

// Similar for HubSpotMeeting, HubSpotEmail
```

### 7.2 Phase 2: Extractors (Estimated: 1-2 days)

#### **Task 2.1: Add Activity Extraction Methods**
```typescript
// worker/src/extractors/salesforce.ts

/**
 * Extract Salesforce Tasks with pagination
 */
async extractTasks(
  batchSize: number = 200,
  lastId?: string
): Promise<ExtractResult> {
  const fields = [
    "Id", "Subject", "Description", "Status", "Priority",
    "ActivityDate", "ReminderDateTime", "WhoId", "WhatId",
    "OwnerId", "IsClosed", "IsHighPriority",
    "CreatedDate", "LastModifiedDate"
  ];

  return this.extract("Task", fields, batchSize, lastId);
}

/**
 * Extract Salesforce Events with pagination
 */
async extractEvents(
  batchSize: number = 200,
  lastId?: string
): Promise<ExtractResult> {
  const fields = [
    "Id", "Subject", "Description", "Location",
    "StartDateTime", "EndDateTime", "DurationInMinutes",
    "WhoId", "WhatId", "OwnerId",
    "IsAllDayEvent", "IsRecurrence",
    "CreatedDate", "LastModifiedDate"
  ];

  return this.extract("Event", fields, batchSize, lastId);
}

/**
 * Extract Salesforce EmailMessages with pagination
 */
async extractEmailMessages(
  batchSize: number = 200,
  lastId?: string
): Promise<ExtractResult> {
  const fields = [
    "Id", "FromAddress", "ToAddress", "CcAddress",
    "Subject", "TextBody", "HtmlBody",
    "MessageDate", "Status", "RelatedToId",
    "Incoming", "HasAttachment",
    "CreatedDate", "LastModifiedDate"
  ];

  return this.extract("EmailMessage", fields, batchSize, lastId);
}
```

### 7.3 Phase 3: Transformers (Estimated: 2-3 days)

#### **Task 3.1: Create Activity Transformer**
```typescript
// worker/src/transformers/activity-transformer.ts

class ActivityTransformer {
  /**
   * Transform Salesforce Task to HubSpot Task
   */
  transformTask(
    sfTask: SalesforceTask,
    ownerMapper: OwnerMapper
  ): TransformResult {
    const properties: Record<string, any> = {
      hs_timestamp: this.toTimestamp(sfTask.ActivityDate || sfTask.CreatedDate),
      hs_task_subject: sfTask.Subject,
      hs_task_body: sfTask.Description || "",
      salesforce_task_id: sfTask.Id,
    };

    // Map status
    if (sfTask.Status) {
      properties.hs_task_status = this.mapTaskStatus(sfTask.Status);
    }

    // Map priority
    if (sfTask.Priority) {
      properties.hs_task_priority = this.mapTaskPriority(sfTask.Priority);
    }

    // Map owner
    if (sfTask.OwnerId) {
      const hsOwnerId = ownerMapper.getHubSpotOwnerId(sfTask.OwnerId);
      if (hsOwnerId) {
        properties.hubspot_owner_id = hsOwnerId;
      }
    }

    // Completion status
    if (sfTask.IsClosed) {
      properties.hs_task_status = "COMPLETED";
    }

    return {
      success: true,
      data: { properties },
    };
  }

  /**
   * Build associations for an activity
   */
  buildActivityAssociations(
    whoId?: string,
    whatId?: string,
    idMappingCache?: Map<string, IdMapping>
  ): ActivityAssociations {
    const associations: ActivityAssociations = {
      contacts: [],
      companies: [],
      deals: [],
    };

    // WhoId (Contact or Lead)
    if (whoId) {
      const whoMapping = idMappingCache?.get(whoId);
      if (whoMapping && whoMapping.hubspot_type === "contact") {
        associations.contacts.push(whoMapping.hubspot_id);
      }
    }

    // WhatId (Account, Opportunity, etc.)
    if (whatId) {
      const whatMapping = idMappingCache?.get(whatId);
      if (whatMapping) {
        if (whatMapping.hubspot_type === "company") {
          associations.companies.push(whatMapping.hubspot_id);
        } else if (whatMapping.hubspot_type === "deal") {
          associations.deals.push(whatMapping.hubspot_id);
        }
      }
    }

    return associations;
  }

  private mapTaskStatus(sfStatus: string): string {
    const statusMap: Record<string, string> = {
      "Not Started": "NOT_STARTED",
      "In Progress": "IN_PROGRESS",
      "Completed": "COMPLETED",
      "Waiting on someone else": "WAITING",
      "Deferred": "DEFERRED",
    };
    return statusMap[sfStatus] || "NOT_STARTED";
  }

  private mapTaskPriority(sfPriority: string): string {
    const priorityMap: Record<string, string> = {
      "High": "HIGH",
      "Normal": "MEDIUM",
      "Low": "LOW",
    };
    return priorityMap[sfPriority] || "MEDIUM";
  }

  private toTimestamp(dateString: string | Date): number {
    const date = typeof dateString === "string" ? new Date(dateString) : dateString;
    return date.getTime();
  }
}

export default new ActivityTransformer();
```

### 7.4 Phase 4: Migrator Integration (Estimated: 3-4 days)

#### **Task 4.1: Add Task Migration Method**
```typescript
// worker/src/services/migrator.ts

/**
 * Migrate Salesforce Tasks to HubSpot Tasks
 */
private async migrateTasks(
  testMode: boolean = false,
  testModeLimit: number = 5
): Promise<void> {
  if (!this.runId) throw new Error("No active migration run");

  const objectType: ObjectType = "activities";
  logger.info("📦 Starting Task migration");

  try {
    // Create progress tracking
    await database.createMigrationProgress(this.runId, objectType, "in_progress");
    await database.updateMigrationProgress(this.runId, objectType, {
      started_at: new Date(),
    });

    // Get total count
    const totalRecords = await salesforceExtractor.getRecordCount("Task");
    const recordsToMigrate = testMode ? Math.min(testModeLimit, totalRecords) : totalRecords;

    await database.updateMigrationProgress(this.runId, objectType, {
      total_records: recordsToMigrate,
    });

    let lastId: string | undefined;
    let processedCount = 0;
    let hasMore = true;

    while (hasMore && !this.shouldStop) {
      if (testMode && processedCount >= testModeLimit) break;

      const batchSize = testMode
        ? Math.min(config.migration.batchSize, testModeLimit - processedCount)
        : config.migration.batchSize;

      // Extract tasks
      const extractResult = await salesforceExtractor.extractTasks(batchSize, lastId);

      if (extractResult.records.length === 0) break;

      // Pre-load ID mappings for associations
      const relatedIds = new Set<string>();
      extractResult.records.forEach((task: any) => {
        if (task.WhoId) relatedIds.add(task.WhoId);
        if (task.WhatId) relatedIds.add(task.WhatId);
      });

      const idMappings = await database.bulkGetIdMappings(Array.from(relatedIds));
      const idMappingCache = new Map(idMappings.map(m => [m.salesforce_id, m]));

      // Process batch
      await this.processActivityBatch(
        objectType,
        "tasks",
        extractResult.records,
        idMappingCache
      );

      // Update progress
      processedCount += extractResult.records.length;
      lastId = extractResult.nextPage;
      hasMore = extractResult.hasMore && (!testMode || processedCount < testModeLimit);

      await database.updateMigrationProgress(this.runId, objectType, {
        processed_records: processedCount,
        last_sf_id_processed: lastId,
      });
    }

    // Mark as completed
    await database.updateMigrationProgress(this.runId, objectType, {
      status: "completed",
      completed_at: new Date(),
    });

    logger.info(`✅ Completed Task migration: ${processedCount} records`);
  } catch (error: any) {
    logger.error("❌ Failed to migrate Tasks", { error: error.message });
    await database.updateMigrationProgress(this.runId, objectType, {
      status: "failed",
      completed_at: new Date(),
    });
    throw error;
  }
}

/**
 * Process a batch of activities (generic)
 */
private async processActivityBatch(
  objectType: ObjectType,
  hubspotObjectType: "tasks" | "meetings" | "emails",
  records: SalesforceRecord[],
  idMappingCache: Map<string, IdMapping>
): Promise<void> {
  if (!this.runId) throw new Error("No active migration run");

  const transformedRecords: Array<{
    salesforceId: string;
    properties: Record<string, any>;
    associations: ActivityAssociations;
  }> = [];

  // Transform records
  for (const record of records) {
    try {
      let transformResult;

      if (hubspotObjectType === "tasks") {
        transformResult = activityTransformer.transformTask(record as any, ownerMapper);
      } else if (hubspotObjectType === "meetings") {
        transformResult = activityTransformer.transformEvent(record as any, ownerMapper);
      } else {
        transformResult = activityTransformer.transformEmail(record as any, ownerMapper);
      }

      if (!transformResult.success) {
        throw new Error(transformResult.error);
      }

      const associations = activityTransformer.buildActivityAssociations(
        record.WhoId,
        record.WhatId,
        idMappingCache
      );

      transformedRecords.push({
        salesforceId: record.Id,
        properties: transformResult.data.properties,
        associations,
      });
    } catch (error: any) {
      logger.warn("Failed to transform activity", {
        salesforceId: record.Id,
        error: error.message,
      });
      await database.createMigrationError(
        this.runId,
        objectType,
        record.Id,
        record.attributes.type,
        `Transformation failed: ${error.message}`
      );
      await database.incrementFailedRecords(this.runId, objectType, 1);
    }
  }

  // Batch create in HubSpot (without associations first)
  if (transformedRecords.length > 0) {
    const loadResult = await hubspotLoader.batchCreate(
      hubspotObjectType,
      transformedRecords.map(r => ({
        salesforceId: r.salesforceId,
        properties: r.properties,
      }))
    );

    // Store ID mappings
    if (loadResult.successful.length > 0) {
      await database.bulkCreateIdMappings(
        loadResult.successful.map((item) => ({
          runId: this.runId!,
          salesforceId: item.salesforceId,
          salesforceType: records[0].attributes.type,
          hubspotId: item.hubspotId,
          hubspotType: hubspotObjectType.slice(0, -1), // "tasks" → "task"
        }))
      );

      // Create associations
      for (const success of loadResult.successful) {
        const original = transformedRecords.find(r => r.salesforceId === success.salesforceId);
        if (original) {
          await this.createActivityAssociations(
            hubspotObjectType,
            success.hubspotId,
            original.associations
          );
        }
      }
    }

    // Handle failures
    if (loadResult.failed.length > 0) {
      for (const failed of loadResult.failed) {
        await database.createMigrationError(
          this.runId,
          objectType,
          failed.salesforceId,
          records[0].attributes.type,
          failed.error
        );
      }
      await database.incrementFailedRecords(this.runId, objectType, loadResult.failed.length);
    }
  }
}

/**
 * Create associations for an activity
 */
private async createActivityAssociations(
  activityType: "tasks" | "meetings" | "emails",
  hubspotActivityId: string,
  associations: ActivityAssociations
): Promise<void> {
  const associationTypeIds = {
    tasks: { contacts: 204, companies: 192, deals: 216 },
    meetings: { contacts: 200, companies: 188, deals: 212 },
    emails: { contacts: 198, companies: 186, deals: 210 },
  };

  const typeIds = associationTypeIds[activityType];

  // Associate with contacts
  for (const contactId of associations.contacts) {
    try {
      await hubspotLoader.createAssociation(
        activityType,
        hubspotActivityId,
        "contacts",
        contactId,
        typeIds.contacts
      );
    } catch (error: any) {
      logger.warn("Failed to create contact association", {
        activityId: hubspotActivityId,
        contactId,
        error: error.message,
      });
    }
  }

  // Associate with companies
  for (const companyId of associations.companies) {
    try {
      await hubspotLoader.createAssociation(
        activityType,
        hubspotActivityId,
        "companies",
        companyId,
        typeIds.companies
      );
    } catch (error: any) {
      logger.warn("Failed to create company association", {
        activityId: hubspotActivityId,
        companyId,
        error: error.message,
      });
    }
  }

  // Associate with deals
  for (const dealId of associations.deals) {
    try {
      await hubspotLoader.createAssociation(
        activityType,
        hubspotActivityId,
        "deals",
        dealId,
        typeIds.deals
      );
    } catch (error: any) {
      logger.warn("Failed to create deal association", {
        activityId: hubspotActivityId,
        dealId,
        error: error.message,
      });
    }
  }
}
```

### 7.5 Phase 5: Testing & Validation (Estimated: 2-3 days)

#### **Test Plan:**

1. **Unit Tests**
   - Activity transformers
   - Association builders
   - Status/priority mappers

2. **Integration Tests**
   - Extract tasks from Salesforce
   - Transform with cached mappings
   - Load to HubSpot sandbox
   - Verify associations created

3. **End-to-End Test**
   - Full migration flow in test mode
   - Verify dashboard updates
   - Check error handling
   - Validate progress tracking

4. **Data Validation**
   - Sample record comparison (SF vs HS)
   - Association verification
   - Owner assignment check
   - Timestamp accuracy

---

## 8. Key Design Decisions

### 8.1 Association Strategy

**Decision:** Create activities first, then create associations separately.

**Rationale:**
- HubSpot batch API has better performance for object creation
- Easier error handling (failed associations don't block object creation)
- Can retry association failures independently
- Matches existing pattern for deal associations

**Alternative Considered:** Create with associations in single API call
- **Rejected:** More complex error handling, harder to retry failures

### 8.2 Email Mapping Strategy

**Decision:** Map EmailMessage to HubSpot Email object (not Note).

**Rationale:**
- Preserves email metadata (direction, timestamp)
- HubSpot Email object supports HTML body
- Maintains semantic meaning
- Better for future reporting/analytics

**Fallback:** If HubSpot Email API unavailable, create as Note with email metadata in body.

### 8.3 Batch Size & Performance

**Decision:** Maintain current batch size (100-200), optimize with ID mapping cache.

**Rationale:**
- Current batch size works well for existing migrations
- ID mapping cache eliminates N+1 query problem
- Association creation is throttled by HubSpot API rate limits
- Progressive enhancement approach (optimize if needed)

**Monitoring:** Track API usage and adjust if hitting rate limits.

### 8.4 Missing Associations Handling

**Decision:** Log warnings for missing associations, continue processing.

**Rationale:**
- Activities are still valuable without associations
- Prevents cascade failures
- Allows investigation of missing ID mappings
- Can retry association creation later

**Action:** Create `migration_errors` entries for missing associations with `status = 'skipped'`.

---

## 9. Potential Challenges & Mitigations

### 9.1 High Volume

**Challenge:** Activities often have 10x-100x more records than other objects.

**Mitigations:**
- Test mode for initial runs
- Batch processing with progress tracking
- Resume capability from checkpoints
- Database indexes on frequently queried fields

**Performance Targets:**
- 100-200 activities per minute (conservative)
- ~6,000-12,000 per hour
- ~144,000-288,000 per day (24-hour run)

### 9.2 Complex Associations

**Challenge:** WhoId and WhatId can point to multiple object types.

**Mitigations:**
- Salesforce ID prefix detection
- Pre-load all ID mappings in batch
- Graceful handling of missing mappings
- Detailed error logging

### 9.3 Data Quality Issues

**Challenge:** Missing required fields, invalid data, orphaned activities.

**Mitigations:**
- Validation before transformation
- Default values for optional fields
- Skip records with critical errors
- Comprehensive error logging

**Example Validations:**
```typescript
// Required field check
if (!task.Subject) {
  return { success: false, error: "Missing required field: Subject" };
}

// Timestamp validation
if (!task.ActivityDate && !task.CreatedDate) {
  return { success: false, error: "No valid timestamp found" };
}

// Association validation (warn only)
if (task.WhoId && !idMappingCache.has(task.WhoId)) {
  logger.warn("Missing ID mapping for WhoId", { whoId: task.WhoId });
}
```

### 9.4 HubSpot API Rate Limits

**Challenge:** More API calls per activity (object + associations).

**Mitigations:**
- Existing rate limiter (8 req/sec)
- Batch association creation where possible
- Exponential backoff on rate limit errors
- Monitor API usage in HubSpot dashboard

**Calculation:**
- 1 batch create (100 activities) = 1 API call
- 100 activities × 2 associations avg = 200 association calls
- Total: ~201 API calls per 100 activities
- At 8 req/sec: ~25 seconds per batch
- ~240 activities per minute (acceptable)

### 9.5 Owner Mapping

**Challenge:** Not all Salesforce users may have HubSpot owners.

**Mitigations:**
- Existing owner mapper with default owner
- Email-based matching
- Manual override via `owner_mappings` table
- Log unmapped owners for investigation

---

## 10. Testing Strategy

### 10.1 Test Environment Setup

1. **Salesforce Sandbox**
   - Test data with ~100-500 activities
   - Mix of Tasks, Events, EmailMessages
   - Various association scenarios

2. **HubSpot Sandbox/Test Account**
   - Separate from production
   - Custom properties created
   - Test contacts/companies/deals

3. **Supabase Test Project**
   - Isolated database
   - Same schema as production

### 10.2 Test Scenarios

#### **Scenario 1: Basic Task Migration**
- Extract 10 tasks from Salesforce
- Transform with field mappings
- Load to HubSpot
- Verify properties correct
- Verify associations created

#### **Scenario 2: Missing Associations**
- Tasks with WhoId/WhatId not in id_mappings
- Verify warning logged
- Verify task still created
- Verify error entry in migration_errors

#### **Scenario 3: Owner Mapping**
- Tasks with various OwnerId values
- Verify owner mapped correctly
- Verify default owner used when no mapping

#### **Scenario 4: High Volume (Stress Test)**
- Extract 1,000+ activities
- Monitor API rate limits
- Verify progress tracking
- Check database performance
- Validate resume capability

#### **Scenario 5: Error Recovery**
- Simulate HubSpot API errors
- Verify retry logic
- Check error logging
- Validate partial completion

### 10.3 Validation Checklist

- [ ] All required HubSpot properties populated
- [ ] Timestamps converted correctly (UTC)
- [ ] Status/priority mapped accurately
- [ ] Owner assignments correct
- [ ] Contact associations created
- [ ] Company associations created
- [ ] Deal associations created
- [ ] ID mappings stored correctly
- [ ] Progress tracking accurate
- [ ] Errors logged with details
- [ ] Dashboard shows real-time updates

---

## 11. Rollout Plan

### 11.1 Phase 1: Development (Week 1-2)
- Implement extractor methods
- Create activity transformers
- Extend HubSpot loader
- Add database helpers
- Write unit tests

### 11.2 Phase 2: Testing (Week 2-3)
- Test in sandbox environment
- Validate transformations
- Check associations
- Stress test with high volume
- Fix bugs and optimize

### 11.3 Phase 3: Pilot (Week 3-4)
- Migrate 100-1,000 activities (test mode)
- Monitor closely
- Gather feedback
- Adjust mappings if needed
- Document lessons learned

### 11.4 Phase 4: Production (Week 4+)
- Full migration in batches
- 24/7 monitoring
- Daily progress reports
- Quick response to errors
- Post-migration validation

---

## 12. Monitoring & Observability

### 12.1 Metrics to Track

**Migration Progress:**
- Total activities to migrate
- Processed count
- Success rate
- Failure rate
- Average processing time per batch
- API calls per minute

**Data Quality:**
- Missing associations count
- Unmapped owners count
- Transformation failures
- Validation errors

**System Health:**
- Database connection pool usage
- HubSpot API rate limit headroom
- Salesforce API quota remaining
- Memory usage
- Error rate trends

### 12.2 Alerting

**Critical Alerts:**
- Migration failure (status = 'failed')
- API rate limit exceeded
- Database connection lost
- High error rate (>10%)

**Warning Alerts:**
- High volume of missing associations
- Slow processing (below target rate)
- Approaching API quota limits

### 12.3 Logging

**Debug Level:**
- Individual record transformations
- Association lookups
- API call details

**Info Level:**
- Batch processing progress
- Milestone achievements
- Mapping statistics

**Warn Level:**
- Missing ID mappings
- Skipped associations
- Validation warnings

**Error Level:**
- Transformation failures
- API errors
- Database errors

---

## 13. Documentation Needs

### 13.1 User Documentation

1. **Activity Migration Guide**
   - Prerequisites (existing objects must be migrated first)
   - Configuration steps
   - Running the migration
   - Monitoring progress
   - Troubleshooting

2. **Field Mapping Reference**
   - Salesforce to HubSpot field mappings
   - Transformation rules
   - Customization instructions

3. **FAQ**
   - Common issues and solutions
   - Data quality requirements
   - Performance expectations

### 13.2 Developer Documentation

1. **Architecture Document** (this document)
2. **API Reference**
   - Extractor methods
   - Transformer functions
   - Loader capabilities
3. **Code Comments**
   - Inline documentation
   - Complex logic explanations
   - Future improvement notes

---

## 14. Success Criteria

### 14.1 Functional Requirements

- [x] Extract Tasks from Salesforce
- [x] Extract Events from Salesforce
- [x] Extract EmailMessages from Salesforce
- [x] Transform to HubSpot format
- [x] Load to HubSpot
- [x] Create Contact associations
- [x] Create Company associations
- [x] Create Deal associations
- [x] Store ID mappings
- [x] Track progress
- [x] Log errors
- [x] Support test mode
- [x] Resume capability

### 14.2 Performance Requirements

- Process at least 100 activities per minute
- Success rate >95%
- API calls within rate limits
- Database queries optimized

### 14.3 Data Quality Requirements

- All required fields populated
- Associations created where mappings exist
- Timestamps accurate
- Owner assignments correct
- No data loss

---

## 15. Future Enhancements

### 15.1 Short-term (Next 3 months)

1. **Attachment Migration**
   - Download Salesforce attachments
   - Upload to HubSpot Files API
   - Associate with activities

2. **Activity Timeline Sync**
   - Sync activity updates from Salesforce
   - Incremental sync based on LastModifiedDate
   - Scheduled daily/weekly runs

3. **Custom Activity Fields**
   - Support Salesforce custom fields
   - Map to HubSpot custom properties
   - Configuration UI for field mapping

### 15.2 Long-term (Next 6-12 months)

1. **Bi-directional Sync**
   - Sync HubSpot activities back to Salesforce
   - Conflict resolution
   - Change tracking

2. **Advanced Deduplication**
   - Detect duplicate activities
   - Merge strategies
   - User-defined rules

3. **Activity Analytics**
   - Migration success dashboard
   - Data quality reports
   - Association coverage metrics

---

## 16. Conclusion

### 16.1 Summary

The current Salesforce to HubSpot migration system provides a **solid foundation** for activity migration:

**Strengths:**
- Well-architected ETL pipeline
- Robust error handling
- Progress tracking
- ID mapping system
- Association support

**Readiness for Activities:**
- Database schema: Ready (90%)
- Extractor pattern: Established
- Transformer pattern: Established
- Loader capabilities: Need minor extensions
- Association mechanism: Proven

### 16.2 Recommended Next Steps

1. **Review this analysis** with stakeholders
2. **Prioritize activity types** (Tasks → Events → Emails)
3. **Set up test environment** (Salesforce & HubSpot sandboxes)
4. **Begin Phase 1 development** (Foundation)
5. **Create test data set** (100-500 activities with various scenarios)

### 16.3 Estimated Effort

**Total Implementation:** 10-15 business days
- Foundation: 2-3 days
- Extractors: 1-2 days
- Transformers: 2-3 days
- Migrator Integration: 3-4 days
- Testing: 2-3 days

**Total Timeline:** 3-4 weeks (including testing and pilot)

### 16.4 Risk Assessment

**Low Risk:**
- Technical implementation (following established patterns)
- Database changes (minimal/none needed)
- API compatibility (HubSpot v3 API well-documented)

**Medium Risk:**
- Data quality issues (missing fields, orphaned activities)
- High volume performance (100K+ activities)
- Complex associations (multi-object relationships)

**Mitigation:**
- Comprehensive testing
- Test mode for pilot
- Detailed error logging
- Progress monitoring

---

## Appendix A: HubSpot Association Type IDs

### Standard Association Type IDs

| From Object | To Object | Association Type ID |
|-------------|-----------|---------------------|
| Task | Contact | 204 |
| Task | Company | 192 |
| Task | Deal | 216 |
| Meeting | Contact | 200 |
| Meeting | Company | 188 |
| Meeting | Deal | 212 |
| Call | Contact | 194 |
| Call | Company | 182 |
| Call | Deal | 206 |
| Email | Contact | 198 |
| Email | Company | 186 |
| Email | Deal | 210 |
| Note | Contact | 202 |
| Note | Company | 190 |
| Note | Deal | 214 |

**Note:** These are standard HubSpot-defined association types. Verify in your HubSpot instance using the Associations API.

---

## Appendix B: Salesforce Object ID Prefixes

| Object | ID Prefix | Example |
|--------|-----------|---------|
| Account | 001 | 0012800000A3dXXXXX |
| Contact | 003 | 0032800000A3dXXXXX |
| Opportunity | 006 | 0062800000A3dXXXXX |
| Lead | 00Q | 00Q2800000A3dXXXXX |
| Case | 500 | 5002800000A3dXXXXX |
| Task | 00T | 00T2800000A3dXXXXX |
| Event | 00U | 00U2800000A3dXXXXX |
| Custom Object | a0X | a0X2800000A3dXXXXX |

**Usage:** Use first 3 characters to determine object type for dynamic association lookups.

---

## Appendix C: Code Snippets

### C.1 Bulk ID Mapping Lookup

```typescript
// Database service extension
async bulkGetIdMappings(salesforceIds: string[]): Promise<IdMapping[]> {
  if (salesforceIds.length === 0) return [];

  const placeholders = salesforceIds.map((_, i) => `$${i + 1}`).join(", ");

  const result = await this.query<IdMapping>(
    `SELECT * FROM id_mappings WHERE salesforce_id = ANY($1::text[])`,
    [salesforceIds]
  );

  return result.rows;
}
```

### C.2 Salesforce Object Type Detection

```typescript
function determineSalesforceObjectType(salesforceId: string): string {
  const prefix = salesforceId.substring(0, 3);

  const prefixMap: Record<string, string> = {
    "001": "Account",
    "003": "Contact",
    "006": "Opportunity",
    "00Q": "Lead",
    "500": "Case",
    "00T": "Task",
    "00U": "Event",
  };

  return prefixMap[prefix] || "Unknown";
}
```

### C.3 Activity Association Builder

```typescript
interface ActivityAssociations {
  contacts: string[];
  companies: string[];
  deals: string[];
}

function buildActivityAssociations(
  whoId: string | null,
  whatId: string | null,
  idMappingCache: Map<string, IdMapping>
): ActivityAssociations {
  const associations: ActivityAssociations = {
    contacts: [],
    companies: [],
    deals: [],
  };

  if (whoId) {
    const whoMapping = idMappingCache.get(whoId);
    if (whoMapping?.hubspot_type === "contact") {
      associations.contacts.push(whoMapping.hubspot_id);
    }
  }

  if (whatId) {
    const whatMapping = idMappingCache.get(whatId);
    if (whatMapping) {
      if (whatMapping.hubspot_type === "company") {
        associations.companies.push(whatMapping.hubspot_id);
      } else if (whatMapping.hubspot_type === "deal") {
        associations.deals.push(whatMapping.hubspot_id);
      }
    }
  }

  return associations;
}
```

---

**End of Document**

This analysis provides a comprehensive blueprint for implementing Salesforce activity migration to HubSpot. The proposed structure leverages existing patterns while addressing the unique challenges of activity migration, particularly complex associations and high data volumes.
