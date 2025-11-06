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
