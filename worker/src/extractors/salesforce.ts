import * as jsforce from "jsforce";
import config from "../config";
import logger from "../utils/logger";
import { retry, RateLimiter } from "../utils/retry";
import { SalesforceRecord, ExtractResult } from "../types";

class SalesforceExtractor {
  private connection: jsforce.Connection | null = null;
  private rateLimiter: RateLimiter;
  private isConnected: boolean = false;

  constructor() {
    // Salesforce typically allows 5000-100000 API calls per day
    // Conservative rate: 10 requests per second
    this.rateLimiter = new RateLimiter(10, 10);
  }

  /**
   * Connect to Salesforce
   */
  async connect(): Promise<void> {
    if (this.isConnected && this.connection) {
      return;
    }

    logger.info("Connecting to Salesforce...");

    this.connection = new jsforce.Connection({
      loginUrl: config.salesforce.loginUrl,
    });

    try {
      await retry(
        async () => {
          await this.connection!.login(
            config.salesforce.username,
            config.salesforce.password + config.salesforce.securityToken,
          );
        },
        {
          maxRetries: config.migration.maxRetries,
          delayMs: 2000,
          exponentialBackoff: true,
        },
      );

      this.isConnected = true;
      logger.info("Successfully connected to Salesforce", {
        instanceUrl: this.connection.instanceUrl,
        organizationId: this.connection.userInfo?.organizationId,
      });
    } catch (error) {
      logger.error("Failed to connect to Salesforce", { error });
      throw error;
    }
  }

  /**
   * Get total count of records for an object type
   */
  async getRecordCount(soqlObject: string): Promise<number> {
    await this.ensureConnected();

    const query = `SELECT COUNT() FROM ${soqlObject}`;

    await this.rateLimiter.waitForToken();

    try {
      const result = await this.connection!.query(query);
      logger.info(`Total ${soqlObject} count: ${result.totalSize}`);
      return result.totalSize;
    } catch (error) {
      logger.error(`Failed to get count for ${soqlObject}`, { error });
      throw error;
    }
  }

  /**
   * Generic extract method - extracts records using SOQL query
   */
  async extract(
    soqlObject: string,
    fields: string[],
    batchSize: number = 200,
    lastId?: string,
    whereClause?: string,
  ): Promise<ExtractResult> {
    await this.ensureConnected();

    let query = `SELECT ${fields.join(", ")} FROM ${soqlObject}`;

    const conditions: string[] = [];
    if (lastId) {
      conditions.push(`Id > '${lastId}'`);
    }
    if (whereClause) {
      conditions.push(whereClause);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }

    query += ` ORDER BY Id ASC LIMIT ${batchSize}`;

    await this.rateLimiter.waitForToken();

    try {
      const result = await this.connection!.query<SalesforceRecord>(query);
      const records = result.records;

      logger.info(`Extracted ${records.length} ${soqlObject} records`, {
        lastId: records[records.length - 1]?.Id,
      });

      return {
        records,
        hasMore: records.length === batchSize,
        nextPage: records[records.length - 1]?.Id,
      };
    } catch (error) {
      logger.error(`Failed to extract ${soqlObject}`, { error });
      throw error;
    }
  }

  /**
   * Extract opportunities with renewal relationships
   */
  async extractOpportunitiesWithRenewals(
    batchSize: number = 200,
    lastId?: string,
  ): Promise<ExtractResult> {
    return this.extract(
      "Opportunity",
      ["Id", "renewal_opportunity__c"],
      batchSize,
      lastId,
      "renewal_opportunity__c != null",
    );
  }

  /**
   * Extract opportunities with pilot relationships
   */
  async extractOpportunitiesWithPilots(
    batchSize: number = 200,
    lastId?: string,
  ): Promise<ExtractResult> {
    return this.extract(
      "Opportunity",
      ["Id", "Pilot_Opportunity__c"],
      batchSize,
      lastId,
      "Pilot_Opportunity__c != null",
    );
  }

  /**
   * Extract Events (calendar meetings/appointments)
   */
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
        "Type",
      ],
      batchSize,
      lastId,
    );
  }

  /**
   * Extract EmailMessages (rich email content)
   */
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
        "ActivityId",
      ],
      batchSize,
      lastId,
    );
  }

  /**
   * Extract Email Tasks (email activity logs)
   */
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
        "TaskSubtype",
      ],
      batchSize,
      lastId,
      "Type = 'Email' OR TaskSubtype = 'Email'",
    );
  }

  /**
   * Extract Call Tasks (phone call activities)
   */
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
        "Type",
      ],
      batchSize,
      lastId,
      "Type = 'Call' OR CallDurationInSeconds != null",
    );
  }

  /**
   * Extract Line Item Schedules grouped by OpportunityLineItem
   * Returns a map of OpportunityLineItemId -> Array of Line Item Schedules
   */
  async extractLineItemSchedulesByLineItem(
    lineItemIds: string[],
  ): Promise<Map<string, any[]>> {
    await this.ensureConnected();

    if (lineItemIds.length === 0) {
      return new Map();
    }

    // Build query with IN clause for line item IDs
    const idsForQuery = lineItemIds.map((id) => `'${id}'`).join(", ");
    const query = `SELECT Id, OpportunityLineItemId, ScheduleDate, Revenue, Quantity
                   FROM OpportunityLineItemSchedule
                   WHERE OpportunityLineItemId IN (${idsForQuery})
                   ORDER BY OpportunityLineItemId, ScheduleDate ASC`;

    await this.rateLimiter.waitForToken();

    try {
      const result = await this.connection!.query<SalesforceRecord>(query);
      const schedulesByLineItem = new Map<string, any[]>();

      // Group schedules by line item
      for (const schedule of result.records) {
        const lineItemId = schedule.OpportunityLineItemId;
        if (!schedulesByLineItem.has(lineItemId)) {
          schedulesByLineItem.set(lineItemId, []);
        }
        schedulesByLineItem.get(lineItemId)!.push(schedule);
      }

      logger.info(
        `Extracted ${result.records.length} Line Item Schedules for ${schedulesByLineItem.size} line items`,
      );

      return schedulesByLineItem;
    } catch (error) {
      logger.error("Failed to extract Line Item Schedules by line item", {
        error,
      });
      throw error;
    }
  }

  /**
   * Extract Line Item Schedules grouped by Opportunity
   * Returns a map of OpportunityId -> Array of Line Item Schedules
   */
  async extractLineItemSchedulesByOpportunity(
    opportunityIds: string[],
  ): Promise<Map<string, any[]>> {
    await this.ensureConnected();

    if (opportunityIds.length === 0) {
      return new Map();
    }

    // Build query with IN clause for opportunity IDs
    const idsForQuery = opportunityIds.map((id) => `'${id}'`).join(", ");
    const query = `SELECT Id, psi_Opportunity__c, ScheduleDate, Revenue, Quantity
                   FROM OpportunityLineItemSchedule
                   WHERE psi_Opportunity__c IN (${idsForQuery})
                   ORDER BY psi_Opportunity__c, ScheduleDate ASC`;

    await this.rateLimiter.waitForToken();

    try {
      const result = await this.connection!.query<SalesforceRecord>(query);
      const schedulesByOpp = new Map<string, any[]>();

      // Group schedules by opportunity
      for (const schedule of result.records) {
        const oppId = schedule.psi_Opportunity__c;
        if (!schedulesByOpp.has(oppId)) {
          schedulesByOpp.set(oppId, []);
        }
        schedulesByOpp.get(oppId)!.push(schedule);
      }

      logger.info(
        `Extracted ${result.records.length} Line Item Schedules for ${schedulesByOpp.size} opportunities`,
      );

      return schedulesByOpp;
    } catch (error) {
      logger.error("Failed to extract Line Item Schedules", { error });
      throw error;
    }
  }

  /**
   * Update Opportunity fields
   */
  async updateOpportunity(
    opportunityId: string,
    updates: Partial<SalesforceRecord>,
  ): Promise<void> {
    await this.ensureConnected();
    await this.rateLimiter.waitForToken();

    try {
      await this.connection!.sobject("Opportunity").update({
        Id: opportunityId,
        ...updates,
      });

      logger.debug("Updated Opportunity", {
        opportunityId,
        fields: Object.keys(updates),
      });
    } catch (error: any) {
      logger.error("Failed to update Opportunity", {
        opportunityId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Batch update Opportunities
   */
  async batchUpdateOpportunities(
    updates: Array<{ Id: string } & Partial<SalesforceRecord>>,
  ): Promise<{
    successful: string[];
    failed: Array<{ id: string; error: string }>;
  }> {
    await this.ensureConnected();

    if (updates.length === 0) {
      return { successful: [], failed: [] };
    }

    const successful: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    // Salesforce allows up to 200 records per batch update
    const batchSize = 200;
    const batches = this.chunkArray(updates, batchSize);

    for (const batch of batches) {
      await this.rateLimiter.waitForToken();

      try {
        const results =
          await this.connection!.sobject("Opportunity").update(batch);

        // Handle results array
        const resultsArray = Array.isArray(results) ? results : [results];

        resultsArray.forEach((result: any, index: number) => {
          if (result.success) {
            successful.push(batch[index].Id);
          } else {
            failed.push({
              id: batch[index].Id,
              error: result.errors?.[0]?.message || "Unknown error",
            });
          }
        });

        logger.info(`Batch updated ${successful.length} Opportunities`, {
          batchSize: batch.length,
        });
      } catch (error: any) {
        logger.error("Batch update failed", {
          error: error.message,
          batchSize: batch.length,
        });

        // Mark all records in this batch as failed
        batch.forEach((record) => {
          failed.push({
            id: record.Id,
            error: error.message,
          });
        });
      }

      // Small delay between batches
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return { successful, failed };
  }

  /**
   * Batch update OpportunityLineItems
   */
  async batchUpdateOpportunityLineItems(
    updates: Array<{ Id: string } & Partial<SalesforceRecord>>,
  ): Promise<{
    successful: string[];
    failed: Array<{ id: string; error: string }>;
  }> {
    await this.ensureConnected();

    if (updates.length === 0) {
      return { successful: [], failed: [] };
    }

    const successful: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    // Salesforce allows up to 200 records per batch update
    const batchSize = 200;
    const batches = this.chunkArray(updates, batchSize);

    for (const batch of batches) {
      await this.rateLimiter.waitForToken();

      try {
        const results = await this.connection!.sobject(
          "OpportunityLineItem",
        ).update(batch);

        // Handle results array
        const resultsArray = Array.isArray(results) ? results : [results];

        resultsArray.forEach((result: any, index: number) => {
          if (result.success) {
            successful.push(batch[index].Id);
          } else {
            failed.push({
              id: batch[index].Id,
              error: result.errors?.[0]?.message || "Unknown error",
            });
          }
        });

        logger.info(`Batch updated ${successful.length} OpportunityLineItems`, {
          batchSize: batch.length,
        });
      } catch (error: any) {
        logger.error("Batch update failed", {
          error: error.message,
          batchSize: batch.length,
        });

        // Mark all records in this batch as failed
        batch.forEach((record) => {
          failed.push({
            id: record.Id,
            error: error.message,
          });
        });
      }

      // Small delay between batches
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return { successful, failed };
  }

  /**
   * Helper to chunk array into smaller batches
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Ensure connection is established
   */
  private async ensureConnected(): Promise<void> {
    if (!this.isConnected || !this.connection) {
      await this.connect();
    }
  }

  /**
   * Get the active connection
   */
  getConnection(): jsforce.Connection | null {
    return this.connection;
  }

  /**
   * Disconnect from Salesforce
   */
  async disconnect(): Promise<void> {
    if (this.connection) {
      await this.connection.logout();
      this.connection = null;
      this.isConnected = false;
      logger.info("Disconnected from Salesforce");
    }
  }
}

export default new SalesforceExtractor();
