// Common types for the migration worker

export type ObjectType =
  | "contacts"
  | "companies"
  | "deals"
  | "activities"
  | "notes"
  | "deal_associations"
  | "opportunity_product_dates"
  | "sync_deal_contract_dates"
  | "opportunity_line_item_dates"
  | "line_items"
  | "cleanup_tasks"
  | "cleanup_meetings"
  | "cleanup_line_items";

export type MigrationStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "paused";

export type ProgressStatus = "pending" | "in_progress" | "completed" | "failed";

export type ErrorStatus = "pending_retry" | "failed" | "resolved" | "skipped";

export interface MigrationRun {
  id: string;
  started_at: Date;
  completed_at?: Date;
  status: MigrationStatus;
  config_snapshot?: Record<string, any>;
  notes?: string;
  created_by?: string;
  updated_at: Date;
}

export interface MigrationProgress {
  id: string;
  run_id: string;
  object_type: ObjectType;
  total_records?: number;
  processed_records: number;
  failed_records: number;
  skipped_records: number;
  last_sf_id_processed?: string;
  last_sf_modified_date?: Date;
  status: ProgressStatus;
  started_at?: Date;
  completed_at?: Date;
  updated_at: Date;
}

export interface IdMapping {
  id: string;
  run_id: string;
  salesforce_id: string;
  salesforce_type: string;
  hubspot_id: string;
  hubspot_type: string;
  migrated_at: Date;
  metadata?: Record<string, any>;
}

export interface MigrationError {
  id: string;
  run_id: string;
  salesforce_id?: string;
  salesforce_type?: string;
  object_type: ObjectType;
  error_message?: string;
  error_details?: Record<string, any>;
  retry_count: number;
  status: ErrorStatus;
  created_at: Date;
  resolved_at?: Date;
  resolved_by?: string;
}

export interface AuditLog {
  id: string;
  run_id: string;
  action: string;
  object_type?: ObjectType;
  record_count?: number;
  metadata?: Record<string, any>;
  timestamp: Date;
}

// Salesforce types
export interface SalesforceRecord {
  Id: string;
  attributes: {
    type: string;
    url: string;
  };
  [key: string]: any;
}

export interface SalesforceContact extends SalesforceRecord {
  FirstName?: string;
  LastName: string;
  Email?: string;
  Phone?: string;
  AccountId?: string;
  Title?: string;
  Department?: string;
  MobilePhone?: string;
  CreatedDate: string;
  LastModifiedDate: string;
}

export interface SalesforceAccount extends SalesforceRecord {
  Name: string;
  Website?: string;
  Phone?: string;
  Industry?: string;
  NumberOfEmployees?: number;
  AnnualRevenue?: number;
  BillingStreet?: string;
  BillingCity?: string;
  BillingState?: string;
  BillingPostalCode?: string;
  BillingCountry?: string;
  CreatedDate: string;
  LastModifiedDate: string;
}

export interface SalesforceOpportunity extends SalesforceRecord {
  Name: string;
  AccountId?: string;
  Amount?: number;
  CloseDate: string;
  StageName: string;
  Probability?: number;
  Type?: string;
  LeadSource?: string;
  Description?: string;
  CreatedDate: string;
  LastModifiedDate: string;
  Product_Start_Date__c?: string;
  Product_End_Date__c?: string;
}

export interface SalesforceOpportunityLineItemSchedule
  extends SalesforceRecord {
  psi_Opportunity__c: string;
  ScheduleDate: string;
  Revenue?: number;
  Quantity?: number;
}

export interface SalesforceOpportunityLineItem extends SalesforceRecord {
  OpportunityId: string;
  Product2Id: string;
  Quantity?: number;
  UnitPrice?: number;
  TotalPrice?: number;
  ServiceDate?: string;
  Start_Date__c?: string;
  End_Date__c?: string;
  installments__c?: number;
  Product2?: {
    Name?: string;
  };
}

// HubSpot types
export interface HubSpotContact {
  properties: {
    email?: string;
    firstname?: string;
    lastname?: string;
    phone?: string;
    jobtitle?: string;
    mobilephone?: string;
    [key: string]: any;
  };
}

export interface HubSpotCompany {
  properties: {
    name: string;
    domain?: string;
    phone?: string;
    industry?: string;
    numberofemployees?: number;
    annualrevenue?: number;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    [key: string]: any;
  };
}

export interface HubSpotDeal {
  properties: {
    dealname: string;
    amount?: string;
    closedate?: string;
    dealstage: string;
    pipeline?: string;
    dealtype?: string;
    description?: string;
    [key: string]: any;
  };
  associations?: Array<{
    to: { id: string };
    types: Array<{ associationCategory: string; associationTypeId: number }>;
  }>;
}

export interface HubSpotLineItem {
  properties: {
    name: string;
    quantity?: number;
    price?: number;
    amount?: number;
    discount?: number;
    start_date?: string;
    end_date?: string;
    installments?: number;
    hs_pricing_model?: string;
    hs_product_type?: string;
    hubspot_owner_id?: string;
    [key: string]: any;
  };
}

// Field mapping types
export interface FieldMapping {
  salesforceField: string;
  hubspotField: string;
  transform?: (value: any) => any;
  required?: boolean;
}

export interface ObjectMapping {
  salesforceObject: string;
  hubspotObject: string;
  fields: FieldMapping[];
}

// Configuration
export interface MigrationConfig {
  batchSize: number;
  maxRetries: number;
  rateLimitDelayMs: number;
  objectTypes: ObjectType[];
  dryRun?: boolean;
}

// Result types
export interface ExtractResult {
  records: SalesforceRecord[];
  hasMore: boolean;
  nextPage?: string;
}

export interface TransformResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface LoadResult {
  success: boolean;
  hubspotId?: string;
  error?: string;
}

export interface BatchLoadResult {
  successful: Array<{ salesforceId: string; hubspotId: string }>;
  failed: Array<{ salesforceId: string; error: string }>;
}
