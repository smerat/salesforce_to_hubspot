import { Client } from "@hubspot/api-client";
import config from "../config";
import logger from "../utils/logger";
import { retry, RateLimiter } from "../utils/retry";
import { BatchLoadResult } from "../types";

class HubSpotLoader {
  private client: Client;
  private rateLimiter: RateLimiter;

  constructor() {
    this.client = new Client({
      accessToken: config.hubspot.accessToken,
    });

    // HubSpot rate limit: 100 requests per 10 seconds = 10 requests per second
    // Be conservative with 8 requests per second
    this.rateLimiter = new RateLimiter(10, 8);
  }

  /**
   * Generic batch create for any HubSpot object
   */
  async batchCreate(
    objectType: string,
    records: Array<{ salesforceId: string; properties: Record<string, any> }>,
  ): Promise<BatchLoadResult> {
    if (records.length === 0) {
      return { successful: [], failed: [] };
    }

    await this.rateLimiter.waitForToken();

    const successful: Array<{ salesforceId: string; hubspotId: string }> = [];
    const failed: Array<{ salesforceId: string; error: string }> = [];

    // HubSpot batch API supports up to 100 records
    const batchSize = 100;
    const batches = this.chunkArray(records, batchSize);

    for (const batch of batches) {
      try {
        const inputs = batch.map((r) => ({
          properties: r.properties,
        }));

        const result = await retry(
          async () => {
            // Handle meetings/tasks/calls/emails which are under crm.objects
            if (
              ["meetings", "tasks", "calls", "emails", "notes"].includes(
                objectType,
              )
            ) {
              return await (this.client.crm.objects as any)[
                objectType
              ].batchApi.create({
                inputs,
              });
            }
            // Handle standard CRM objects (companies, contacts, deals, etc)
            return await (this.client.crm as any)[objectType].batchApi.create({
              inputs,
            });
          },
          {
            maxRetries: config.migration.maxRetries,
            delayMs: 1000,
          },
        );

        result.results.forEach((hubspotRecord: any, index: number) => {
          successful.push({
            salesforceId: batch[index].salesforceId,
            hubspotId: hubspotRecord.id,
          });
        });

        logger.info(
          `Batch created ${result.results.length} ${objectType} in HubSpot`,
        );
      } catch (error: any) {
        console.error("=== BATCH CREATE ERROR ===");
        console.error("Message:", error.message);
        console.error("Status:", error.code);
        console.error("Body:", JSON.stringify(error.body, null, 2));
        console.error("Full Error:", error);
        console.error("========================");

        logger.error(
          "Batch create failed - stopping migration for troubleshooting",
          {
            error: error.message,
            body: error.body,
            statusCode: error.code,
            batchSize: batch.length,
          },
        );

        // Stop the entire migration - don't fall back to individual creates
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return { successful, failed };
  }

  /**
   * Create a single record in HubSpot
   */
  async createSingle(
    objectType: string,
    properties: Record<string, any>,
  ): Promise<string> {
    await this.rateLimiter.waitForToken();

    try {
      const result = await retry(
        async () => {
          return await (this.client.crm as any)[objectType].basicApi.create({
            properties,
            associations: [],
          });
        },
        {
          maxRetries: config.migration.maxRetries,
          delayMs: 1000,
          exponentialBackoff: true,
        },
      );

      logger.debug(`Created ${objectType} in HubSpot`, { id: result.id });
      return result.id;
    } catch (error: any) {
      logger.error(`Failed to create ${objectType} in HubSpot`, {
        error: error.message,
        body: error.body,
        statusCode: error.code,
        properties,
      });
      throw error;
    }
  }

  /**
   * Search for deals by property value
   */
  async searchDealsByProperty(
    propertyName: string,
    propertyValue: string,
  ): Promise<string | null> {
    await this.rateLimiter.waitForToken();

    try {
      const result = await retry(
        async () => {
          return await this.client.crm.deals.searchApi.doSearch({
            filterGroups: [
              {
                filters: [
                  {
                    propertyName,
                    operator: "EQ" as any,
                    value: propertyValue,
                  },
                ],
              },
            ],
            properties: [propertyName],
            limit: 1,
            after: 0,
            sorts: [],
          } as any);
        },
        {
          maxRetries: config.migration.maxRetries,
          delayMs: 1000,
        },
      );

      if (result.results && result.results.length > 0) {
        logger.debug("Found deal by property", {
          propertyName,
          propertyValue,
          dealId: result.results[0].id,
        });
        return result.results[0].id;
      }

      logger.debug("No deal found with property", {
        propertyName,
        propertyValue,
      });
      return null;
    } catch (error: any) {
      logger.error("Failed to search deals by property", {
        error: error.message,
        propertyName,
        propertyValue,
      });
      throw error;
    }
  }

  /**
   * Get association label IDs for deal-to-deal associations
   */
  async getDealAssociationLabelIds(
    labelName: string,
  ): Promise<{ forward: number; reverse: number } | null> {
    await this.rateLimiter.waitForToken();

    try {
      const result = await retry(
        async () => {
          return await this.client.crm.associations.v4.schema.definitionsApi.getAll(
            "deals",
            "deals",
          );
        },
        {
          maxRetries: config.migration.maxRetries,
          delayMs: 1000,
        },
      );

      logger.info("All deal-to-deal associations retrieved", {
        count: result.results.length,
        labels: result.results.map((r: any) => ({
          typeId: r.typeId,
          label: r.label,
        })),
      });

      // For bidirectional associations, HubSpot returns two separate entries
      // Determine which labels to look for based on the labelName parameter
      let forwardLabelText: string;
      let reverseLabelText: string;

      if (labelName === "renewed_in_renewal_of") {
        forwardLabelText = "renewed in";
        reverseLabelText = "renewal of";
      } else if (labelName === "has_pilot_pilot_for") {
        forwardLabelText = "has pilot";
        reverseLabelText = "pilot for";
      } else {
        logger.error("Unknown association label name", { labelName });
        return null;
      }

      const forwardLabel: any = result.results.find(
        (label: any) =>
          label.label?.toLowerCase() === forwardLabelText &&
          label.category === "USER_DEFINED",
      );

      const reverseLabel: any = result.results.find(
        (label: any) =>
          label.label?.toLowerCase() === reverseLabelText &&
          label.category === "USER_DEFINED",
      );

      if (forwardLabel && reverseLabel) {
        logger.info("Found bidirectional association labels", {
          forward: {
            typeId: forwardLabel.typeId,
            label: forwardLabel.label,
          },
          reverse: {
            typeId: reverseLabel.typeId,
            label: reverseLabel.label,
          },
        });

        return {
          forward: parseInt(forwardLabel.typeId),
          reverse: parseInt(reverseLabel.typeId),
        };
      }

      logger.warn("Association labels not found", {
        labelName,
        forwardLabelText,
        reverseLabelText,
        availableLabels: result.results.map((r: any) => r.label),
        foundForward: !!forwardLabel,
        foundReverse: !!reverseLabel,
      });
      return null;
    } catch (error: any) {
      logger.error("Failed to get association label IDs", {
        error: error.message,
        labelName,
      });
      throw error;
    }
  }

  /**
   * Create association between two HubSpot objects using v4 API
   */
  async createAssociation(
    fromObjectType: string,
    fromObjectId: string,
    toObjectType: string,
    toObjectId: string,
    associationTypeId: number,
  ): Promise<void> {
    await this.rateLimiter.waitForToken();

    try {
      await retry(
        async () => {
          // Use v4 basic API to create association
          await this.client.crm.associations.v4.basicApi.create(
            fromObjectType as any,
            fromObjectId,
            toObjectType as any,
            toObjectId,
            [
              {
                associationCategory: "USER_DEFINED",
                associationTypeId: associationTypeId,
              },
            ] as any,
          );
        },
        {
          maxRetries: config.migration.maxRetries,
          delayMs: 1000,
        },
      );

      logger.debug("Created association in HubSpot", {
        from: `${fromObjectType}:${fromObjectId}`,
        to: `${toObjectType}:${toObjectId}`,
        associationTypeId,
      });
    } catch (error: any) {
      logger.error("Failed to create association in HubSpot", {
        error: error.message,
        errorBody: error.body,
        errorCode: error.code,
        fromObjectType,
        fromObjectId,
        toObjectType,
        toObjectId,
        associationTypeId,
      });

      console.error("=== ASSOCIATION ERROR DETAILS ===");
      console.error("Error:", error);
      console.error("Body:", JSON.stringify(error.body, null, 2));
      console.error("=================================");

      throw error;
    }
  }

  /**
   * Create a Meeting engagement in HubSpot
   */
  async createMeeting(properties: Record<string, any>): Promise<string> {
    await this.rateLimiter.waitForToken();

    try {
      const result = await retry(
        async () => {
          return await this.client.crm.objects.meetings.basicApi.create({
            properties,
            associations: [],
          });
        },
        {
          maxRetries: config.migration.maxRetries,
          delayMs: 1000,
        },
      );

      logger.debug("Created meeting in HubSpot", { meetingId: result.id });
      return result.id;
    } catch (error: any) {
      console.error("=== MEETING CREATION ERROR ===");
      console.error("Error message:", error.message);
      console.error("Error code:", error.code);
      console.error("Error body:", JSON.stringify(error.body, null, 2));
      console.error("Properties sent:", JSON.stringify(properties, null, 2));
      console.error("Full error:", error);
      console.error("==============================");

      logger.error("Failed to create meeting", {
        error: error.message,
        errorCode: error.code,
        errorBody: error.body,
        properties,
      });
      throw error;
    }
  }

  /**
   * Create an Email engagement in HubSpot
   */
  async createEmail(properties: Record<string, any>): Promise<string> {
    await this.rateLimiter.waitForToken();

    try {
      const result = await retry(
        async () => {
          return await this.client.crm.objects.emails.basicApi.create({
            properties,
            associations: [],
          });
        },
        {
          maxRetries: config.migration.maxRetries,
          delayMs: 1000,
        },
      );

      logger.debug("Created email in HubSpot", { emailId: result.id });
      return result.id;
    } catch (error: any) {
      logger.error("Failed to create email", {
        error: error.message,
        properties,
      });
      throw error;
    }
  }

  /**
   * Create a Call engagement in HubSpot
   */
  async createCall(properties: Record<string, any>): Promise<string> {
    await this.rateLimiter.waitForToken();

    try {
      const result = await retry(
        async () => {
          return await this.client.crm.objects.calls.basicApi.create({
            properties,
            associations: [],
          });
        },
        {
          maxRetries: config.migration.maxRetries,
          delayMs: 1000,
        },
      );

      logger.debug("Created call in HubSpot", { callId: result.id });
      return result.id;
    } catch (error: any) {
      logger.error("Failed to create call", {
        error: error.message,
        properties,
      });
      throw error;
    }
  }

  /**
   * Batch create calls with associations in HubSpot
   */
  async batchCreateCallsWithAssociations(
    inputs: Array<{
      properties: Record<string, any>;
      associations: any[];
    }>,
  ): Promise<void> {
    if (inputs.length === 0) {
      return;
    }

    await this.rateLimiter.waitForToken();

    try {
      const result = await retry(
        async () => {
          return await this.client.crm.objects.calls.batchApi.create({
            inputs,
          });
        },
        {
          maxRetries: config.migration.maxRetries,
          delayMs: 1000,
        },
      );

      logger.info(`Batch created ${result.results.length} calls in HubSpot`);
    } catch (error: any) {
      console.error("=== BATCH CREATE CALLS ERROR ===");
      console.error("Message:", error.message);
      console.error("Status:", error.code);
      console.error("Body:", JSON.stringify(error.body, null, 2));
      console.error("Input count:", inputs.length);
      console.error("Full Error:", error);
      console.error("================================");

      logger.error("Batch create calls failed", {
        error: error.message,
        body: error.body,
        statusCode: error.code,
        inputCount: inputs.length,
      });

      throw error;
    }
  }

  /**
   * Batch create emails with associations in HubSpot
   */
  async batchCreateEmailsWithAssociations(
    inputs: Array<{
      properties: Record<string, any>;
      associations: any[];
    }>,
  ): Promise<void> {
    if (inputs.length === 0) {
      return;
    }

    await this.rateLimiter.waitForToken();

    try {
      const result = await retry(
        async () => {
          return await this.client.crm.objects.emails.batchApi.create({
            inputs,
          });
        },
        {
          maxRetries: config.migration.maxRetries,
          delayMs: 1000,
        },
      );

      logger.info(`Batch created ${result.results.length} emails in HubSpot`);
    } catch (error: any) {
      console.error("=== BATCH CREATE EMAILS ERROR ===");
      console.error("Message:", error.message);
      console.error("Status:", error.code);
      console.error("Body:", JSON.stringify(error.body, null, 2));
      console.error("====================================");

      logger.error("Batch create emails failed", {
        error: error.message,
        body: error.body,
        statusCode: error.code,
        batchSize: inputs.length,
      });

      throw error;
    }
  }

  /**
   * Batch create meetings with associations in HubSpot
   */
  async batchCreateMeetingsWithAssociations(
    inputs: Array<{
      properties: Record<string, any>;
      associations: any[];
    }>,
  ): Promise<void> {
    if (inputs.length === 0) {
      return;
    }

    await this.rateLimiter.waitForToken();

    try {
      const result = await retry(
        async () => {
          return await this.client.crm.objects.meetings.batchApi.create({
            inputs,
          });
        },
        {
          maxRetries: config.migration.maxRetries,
          delayMs: 1000,
        },
      );

      logger.info(`Batch created ${result.results.length} meetings in HubSpot`);
    } catch (error: any) {
      console.error("=== BATCH CREATE MEETINGS ERROR ===");
      console.error("Message:", error.message);
      console.error("Status:", error.code);
      console.error("Body:", JSON.stringify(error.body, null, 2));
      console.error("====================================");

      logger.error("Batch create meetings failed", {
        error: error.message,
        body: error.body,
        statusCode: error.code,
        batchSize: inputs.length,
      });

      throw error;
    }
  }

  /**
   * Batch create tasks with associations
   */
  async batchCreateTasksWithAssociations(
    inputs: Array<{
      properties: Record<string, any>;
      associations: any[];
    }>,
  ): Promise<void> {
    if (inputs.length === 0) {
      return;
    }

    await this.rateLimiter.waitForToken();

    try {
      const result = await retry(
        async () => {
          return await this.client.crm.objects.tasks.batchApi.create({
            inputs,
          });
        },
        {
          maxRetries: config.migration.maxRetries,
          delayMs: 1000,
        },
      );

      logger.info(`Batch created ${result.results.length} tasks in HubSpot`);
    } catch (error: any) {
      console.error("=== BATCH CREATE TASKS ERROR ===");
      console.error("Message:", error.message);
      console.error("Status:", error.code);
      console.error("Body:", JSON.stringify(error.body, null, 2));
      console.error("====================================");

      logger.error("Batch create tasks failed", {
        error: error.message,
        body: error.body,
        statusCode: error.code,
        batchSize: inputs.length,
      });

      throw error;
    }
  }

  /**
   * Find HubSpot object by Salesforce ID property
   */
  async findObjectBySalesforceId(
    objectType: "contacts" | "companies" | "deals",
    salesforceId: string,
  ): Promise<string | null> {
    await this.rateLimiter.waitForToken();

    const propertyMap = {
      contacts: "salesforcecontactid",
      companies: "salesforceaccountid",
      deals: "hs_salesforceopportunityid",
    };

    const propertyName = propertyMap[objectType];

    try {
      const searchResult = await this.client.crm[objectType].searchApi.doSearch(
        {
          filterGroups: [
            {
              filters: [
                {
                  propertyName,
                  operator: "EQ",
                  value: salesforceId,
                },
              ],
            },
          ],
          limit: 1,
        },
      );

      if (searchResult.results.length > 0) {
        return searchResult.results[0].id;
      }

      return null;
    } catch (error: any) {
      logger.warn("Failed to search for object by Salesforce ID", {
        objectType,
        salesforceId,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Bulk find HubSpot objects by Salesforce IDs
   * Chunks requests into batches of 100 (HubSpot's IN filter limit)
   */
  async bulkFindObjectsBySalesforceIds(
    objectType: "contacts" | "companies" | "deals",
    salesforceIds: string[],
  ): Promise<Map<string, string>> {
    if (salesforceIds.length === 0) {
      return new Map();
    }

    const propertyMap = {
      contacts: "salesforcecontactid",
      companies: "salesforceaccountid",
      deals: "hs_salesforceopportunityid",
    };

    const propertyName = propertyMap[objectType];
    const results = new Map<string, string>();

    // HubSpot's IN filter only allows 100 values max, so we need to chunk
    const batchSize = 100;
    const batches = this.chunkArray(salesforceIds, batchSize);

    logger.info(
      `Searching for ${salesforceIds.length} ${objectType} in ${batches.length} batches`,
    );

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      await this.rateLimiter.waitForToken();

      // Log first batch for debugging
      if (i === 0) {
        console.log(`\n=== First batch search for ${objectType} ===`);
        console.log(`Property: ${propertyName}`);
        console.log(`Batch size: ${batch.length}`);
        console.log(`Sample IDs (first 5):`, batch.slice(0, 5));
        console.log(
          `Search query:`,
          JSON.stringify(
            {
              filterGroups: [
                {
                  filters: [
                    {
                      propertyName,
                      operator: "IN",
                      values: batch.slice(0, 5),
                    },
                  ],
                },
              ],
              properties: [propertyName],
              limit: 100,
            },
            null,
            2,
          ),
        );
      }

      try {
        const searchResult = await this.client.crm[
          objectType
        ].searchApi.doSearch({
          filterGroups: [
            {
              filters: [
                {
                  propertyName,
                  operator: "IN",
                  values: batch,
                },
              ],
            },
          ],
          properties: [propertyName],
          limit: 100,
        });

        for (const result of searchResult.results) {
          const sfId = (result.properties as any)[propertyName];
          if (sfId) {
            results.set(sfId, result.id);
          }
        }

        logger.debug(
          `Batch ${i + 1}/${batches.length}: Found ${searchResult.results.length} ${objectType}`,
        );
      } catch (error: any) {
        logger.error(
          `Failed to search batch ${i + 1}/${batches.length} for ${objectType}`,
          {
            error: error.message,
            batchSize: batch.length,
            errorBody: error.body,
            statusCode: error.code,
          },
        );
        console.error(
          "Full batch search error:",
          JSON.stringify(error, null, 2),
        );
        // Continue with other batches even if one fails
      }
    }

    logger.info(
      `Found ${results.size} ${objectType} out of ${salesforceIds.length} Salesforce IDs`,
    );

    return results;
  }

  /**
   * Create association between engagement and CRM object
   */
  async createEngagementAssociation(
    fromObjectType: string, // 'meetings', 'emails', 'calls'
    fromObjectId: string,
    toObjectType: string, // 'contacts', 'companies', 'deals'
    toObjectId: string,
    associationTypeId: number,
  ): Promise<void> {
    await this.rateLimiter.waitForToken();

    logger.info("Creating association", {
      fromObjectType,
      fromObjectId,
      toObjectType,
      toObjectId,
      associationTypeId,
    });

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
        },
      );

      logger.info("Successfully created engagement association", {
        fromObjectType,
        fromObjectId,
        toObjectType,
        toObjectId,
        associationTypeId,
      });
    } catch (error: any) {
      // Check if it's a 404 or validation error for invalid object IDs
      const isNotFoundError =
        error.code === 404 ||
        (error.body?.message?.includes("invalid") &&
          error.body?.context?.INVALID_OBJECT_IDS);

      if (isNotFoundError) {
        logger.warn("Skipping association - object not found in HubSpot", {
          fromObjectType,
          fromObjectId,
          toObjectType,
          toObjectId,
          error: error.message,
          errorBody: error.body,
        });
        // Don't throw - this is expected if objects were deleted
        return;
      }

      logger.error("Failed to create engagement association", {
        error: error.message,
        fromObjectType,
        fromObjectId,
        toObjectType,
        toObjectId,
        associationTypeId,
      });
      throw error;
    }
  }

  /**
   * Update a single deal's properties
   */
  async updateDeal(
    dealId: string,
    properties: Record<string, any>,
  ): Promise<void> {
    await this.rateLimiter.waitForToken();

    try {
      await retry(
        async () => {
          return await this.client.crm.deals.basicApi.update(dealId, {
            properties,
          });
        },
        {
          maxRetries: config.migration.maxRetries,
          delayMs: 1000,
        },
      );

      logger.debug("Updated deal in HubSpot", { dealId, properties });
    } catch (error: any) {
      logger.error("Failed to update deal in HubSpot", {
        error: error.message,
        dealId,
        properties,
      });
      throw error;
    }
  }

  /**
   * Batch update deals
   */
  async batchUpdateDeals(
    updates: Array<{ dealId: string; properties: Record<string, any> }>,
  ): Promise<{
    successful: string[];
    failed: Array<{ id: string; error: string }>;
  }> {
    if (updates.length === 0) {
      return { successful: [], failed: [] };
    }

    const successful: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    // HubSpot allows up to 100 records per batch update
    const batchSize = 100;
    const batches = this.chunkArray(updates, batchSize);

    for (const batch of batches) {
      await this.rateLimiter.waitForToken();

      try {
        const inputs = batch.map((u) => ({
          id: u.dealId,
          properties: u.properties,
        }));

        const result = await retry(
          async () => {
            return await this.client.crm.deals.batchApi.update({ inputs });
          },
          {
            maxRetries: config.migration.maxRetries,
            delayMs: 1000,
          },
        );

        result.results.forEach((hubspotRecord: any, index: number) => {
          successful.push(batch[index].dealId);
        });

        logger.info(`Batch updated ${result.results.length} deals in HubSpot`);
      } catch (error: any) {
        logger.error("Batch update deals failed", {
          error: error.message,
          batchSize: batch.length,
        });

        // Try individual updates for this batch
        for (const update of batch) {
          try {
            await this.updateDeal(update.dealId, update.properties);
            successful.push(update.dealId);
          } catch (individualError: any) {
            failed.push({
              id: update.dealId,
              error: individualError.message,
            });
          }
        }
      }

      // Small delay between batches
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return { successful, failed };
  }

  /**
   * Create line items in HubSpot with deal associations
   */
  async createLineItems(
    lineItems: Array<{
      salesforceId: string;
      properties: Record<string, any>;
      dealId?: string;
    }>,
  ): Promise<BatchLoadResult> {
    if (lineItems.length === 0) {
      return { successful: [], failed: [] };
    }

    const successful: Array<{ salesforceId: string; hubspotId: string }> = [];
    const failed: Array<{ salesforceId: string; error: string }> = [];

    // HubSpot batch API supports up to 100 records
    const batchSize = 100;
    const batches = this.chunkArray(lineItems, batchSize);

    for (const batch of batches) {
      await this.rateLimiter.waitForToken();

      try {
        const inputs = batch.map((item) => {
          const input: any = {
            properties: item.properties,
          };

          // Add association if dealId is provided
          if (item.dealId) {
            input.associations = [
              {
                to: { id: item.dealId },
                types: [
                  {
                    associationCategory: "HUBSPOT_DEFINED",
                    associationTypeId: 20,
                  },
                ],
              },
            ];
          }

          return input;
        });

        const result = await retry(
          async () => {
            return await this.client.crm.lineItems.batchApi.create({
              inputs,
            });
          },
          {
            maxRetries: config.migration.maxRetries,
            delayMs: 1000,
          },
        );

        result.results.forEach((hubspotRecord: any, index: number) => {
          successful.push({
            salesforceId: batch[index].salesforceId,
            hubspotId: hubspotRecord.id,
          });
        });

        logger.info(
          `Batch created ${result.results.length} line items in HubSpot`,
        );
      } catch (error: any) {
        logger.error("Batch create line items failed", {
          error: error.message,
          body: error.body,
          statusCode: error.code,
          category: error.category,
          batchSize: batch.length,
        });

        // Log detailed error information
        if (error.body) {
          console.error("=== BATCH CREATE ERROR BODY ===");
          console.error(JSON.stringify(error.body, null, 2));
          console.error("================================");
          logger.error(
            "Error body details:",
            JSON.stringify(error.body, null, 2),
          );
        } else {
          console.error("=== BATCH CREATE ERROR (no body) ===");
          console.error("Message:", error.message);
          console.error("Code:", error.code);
          console.error("Category:", error.category);
          console.error("====================================");
        }

        // Try individual creates for this batch - INCLUDE ASSOCIATIONS!
        for (const item of batch) {
          try {
            await this.rateLimiter.waitForToken();

            const input: any = {
              properties: item.properties,
            };

            // Include associations if dealId is provided
            if (item.dealId) {
              input.associations = [
                {
                  to: { id: item.dealId },
                  types: [
                    {
                      associationCategory: "HUBSPOT_DEFINED",
                      associationTypeId: 20,
                    },
                  ],
                },
              ];
            }

            const result =
              await this.client.crm.lineItems.basicApi.create(input);
            successful.push({
              salesforceId: item.salesforceId,
              hubspotId: result.id,
            });
          } catch (individualError: any) {
            console.error("Individual line item create failed:", {
              salesforceId: item.salesforceId,
              error: individualError.message,
              body: individualError.body,
            });
            failed.push({
              salesforceId: item.salesforceId,
              error:
                individualError.message || JSON.stringify(individualError.body),
            });
          }
        }
      }

      // Small delay between batches
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return { successful, failed };
  }

  /**
   * Associate line items with deals
   */
  async associateLineItemsWithDeals(
    associations: Array<{
      lineItemId: string;
      dealId: string;
    }>,
  ): Promise<{
    successful: string[];
    failed: Array<{ lineItemId: string; error: string }>;
  }> {
    if (associations.length === 0) {
      return { successful: [], failed: [] };
    }

    const successful: string[] = [];
    const failed: Array<{ lineItemId: string; error: string }> = [];

    // HubSpot batch associations API supports up to 100 associations
    const batchSize = 100;
    const batches = this.chunkArray(associations, batchSize);

    for (const batch of batches) {
      await this.rateLimiter.waitForToken();

      try {
        const inputs = batch.map((assoc) => ({
          from: { id: assoc.lineItemId },
          to: { id: assoc.dealId },
          type: "line_item_to_deal",
        }));

        await retry(
          async () => {
            return await this.client.crm.lineItems.associationsApi.create(
              batch[0].lineItemId,
              "deals",
              batch[0].dealId,
              [
                {
                  associationCategory: "HUBSPOT_DEFINED",
                  associationTypeId: 20,
                },
              ],
            );
          },
          {
            maxRetries: config.migration.maxRetries,
            delayMs: 1000,
          },
        );

        // If batch API doesn't work, do individual associations
        for (const assoc of batch) {
          try {
            await this.rateLimiter.waitForToken();
            await this.client.crm.lineItems.associationsApi.create(
              assoc.lineItemId,
              "deals",
              assoc.dealId,
              [
                {
                  associationCategory: "HUBSPOT_DEFINED",
                  associationTypeId: 20,
                },
              ],
            );
            successful.push(assoc.lineItemId);
          } catch (individualError: any) {
            failed.push({
              lineItemId: assoc.lineItemId,
              error: individualError.message,
            });
          }
        }

        logger.info(`Associated ${successful.length} line items with deals`);
      } catch (error: any) {
        logger.error("Batch associate line items failed", {
          error: error.message,
          batchSize: batch.length,
        });

        // Mark all as failed for this batch
        batch.forEach((assoc) => {
          failed.push({
            lineItemId: assoc.lineItemId,
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
   * Delete all line items (useful for cleanup before re-running migration)
   */
  async deleteAllLineItems(): Promise<number> {
    let totalDeleted = 0;
    let hasMore = true;

    logger.info("Starting to delete all line items from HubSpot");

    try {
      while (hasMore) {
        await this.rateLimiter.waitForToken();

        // Search for line items
        const searchResponse =
          await this.client.crm.lineItems.searchApi.doSearch({
            filterGroups: [],
            limit: 100,
          });

        const lineItemIds = searchResponse.results.map((item) => item.id);

        if (lineItemIds.length === 0) {
          hasMore = false;
          break;
        }

        logger.info(`Found ${lineItemIds.length} line items to delete`);

        // Delete in batches
        const batchSize = 100;
        for (let i = 0; i < lineItemIds.length; i += batchSize) {
          const batch = lineItemIds.slice(i, i + batchSize);

          await this.rateLimiter.waitForToken();

          try {
            await this.client.crm.lineItems.batchApi.archive({
              inputs: batch.map((id) => ({ id })),
            });
            totalDeleted += batch.length;
            logger.info(
              `Deleted ${batch.length} line items (total: ${totalDeleted})`,
            );
          } catch (error: any) {
            logger.error("Failed to delete batch of line items", {
              error: error.message,
              batchSize: batch.length,
            });
          }
        }

        // Wait for HubSpot's search index to catch up
        logger.info("Waiting 2 seconds for HubSpot search index to update...");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      logger.info(`✅ Total line items deleted: ${totalDeleted}`);
      return totalDeleted;
    } catch (error: any) {
      logger.error("Failed to search/delete line items", {
        error: error.message,
      });
      return totalDeleted;
    }
  }

  /**
   * Delete all tasks (useful for cleanup before re-running migration)
   */
  async deleteAllTasks(): Promise<number> {
    let totalDeleted = 0;
    let iterationCount = 0;

    logger.info("Starting to delete all tasks from HubSpot");

    try {
      while (true) {
        iterationCount++;
        await this.rateLimiter.waitForToken();

        // Use getAll (list API) instead of search - this is real-time, not indexed
        const listResponse = await this.client.crm.objects.tasks.getAll(100);

        const taskIds = listResponse.results.map((item: any) => item.id);

        logger.info(
          `Iteration ${iterationCount}: Found ${taskIds.length} tasks to delete`,
        );

        if (taskIds.length === 0) {
          break;
        }

        // Delete in batches
        const batchSize = 100;
        for (let i = 0; i < taskIds.length; i += batchSize) {
          const batch = taskIds.slice(i, i + batchSize);

          await this.rateLimiter.waitForToken();

          try {
            await this.client.crm.objects.tasks.batchApi.archive({
              inputs: batch.map((id) => ({ id })),
            });
            totalDeleted += batch.length;
            logger.info(
              `Deleted ${batch.length} tasks (total: ${totalDeleted})`,
            );
          } catch (error: any) {
            logger.error("Failed to delete batch of tasks", {
              error: error.message,
              batchSize: batch.length,
            });
          }
        }
      }

      logger.info(`✅ Total tasks deleted: ${totalDeleted}`);
      return totalDeleted;
    } catch (error: any) {
      logger.error("Failed to list/delete tasks", {
        error: error.message,
      });
      return totalDeleted;
    }
  }

  /**
   * Delete all meetings (useful for cleanup before re-running migration)
   */
  async deleteAllMeetings(): Promise<number> {
    let totalDeleted = 0;

    logger.info("Starting to delete all meetings from HubSpot");

    try {
      // Keep deleting until no more meetings exist
      while (true) {
        await this.rateLimiter.waitForToken();

        // List meetings (real-time, not search index)
        const listResponse =
          await this.client.crm.objects.meetings.basicApi.getPage(
            100, // limit
            undefined, // after (always get first page since we're deleting)
          );

        const meetingIds = listResponse.results.map((item: any) => item.id);

        logger.info(`Found ${meetingIds.length} meetings to delete`);

        if (meetingIds.length === 0) {
          logger.info("No more meetings found, stopping.");
          break;
        }

        // Delete in batches
        const batchSize = 100;
        for (let i = 0; i < meetingIds.length; i += batchSize) {
          const batch = meetingIds.slice(i, i + batchSize);

          await this.rateLimiter.waitForToken();

          try {
            await this.client.crm.objects.meetings.batchApi.archive({
              inputs: batch.map((id) => ({ id })),
            });
            totalDeleted += batch.length;
            logger.info(
              `Deleted ${batch.length} meetings (total: ${totalDeleted})`,
            );
          } catch (error: any) {
            logger.error("Failed to delete batch of meetings", {
              error: error.message,
              batchSize: batch.length,
            });
          }
        }
      }

      logger.info(`✅ Total meetings deleted: ${totalDeleted}`);
      return totalDeleted;
    } catch (error: any) {
      console.error("=== DELETE MEETINGS ERROR ===");
      console.error("Error message:", error.message);
      console.error("Error code:", error.code);
      console.error("Error body:", JSON.stringify(error.body, null, 2));
      console.error("Full error:", error);
      console.error("============================");

      logger.error("Failed to list/delete meetings", {
        error: error.message,
        errorCode: error.code,
        errorBody: error.body,
      });
      return totalDeleted;
    }
  }

  async deleteAllEmails(): Promise<number> {
    let totalDeleted = 0;

    logger.info("Starting to delete all emails from HubSpot");

    try {
      // Keep deleting until no more emails exist
      while (true) {
        await this.rateLimiter.waitForToken();

        // List emails (real-time, not search index)
        const listResponse =
          await this.client.crm.objects.emails.basicApi.getPage(
            100, // limit
            undefined, // after (always get first page since we're deleting)
          );

        const emailIds = listResponse.results.map((item: any) => item.id);

        logger.info(`Found ${emailIds.length} emails to delete`);

        if (emailIds.length === 0) {
          logger.info("No more emails found, stopping.");
          break;
        }

        // Delete in batches
        const batchSize = 100;
        for (let i = 0; i < emailIds.length; i += batchSize) {
          const batch = emailIds.slice(i, i + batchSize);

          await this.rateLimiter.waitForToken();

          try {
            await this.client.crm.objects.emails.batchApi.archive({
              inputs: batch.map((id) => ({ id })),
            });
            totalDeleted += batch.length;
            logger.info(
              `Deleted ${batch.length} emails (total: ${totalDeleted})`,
            );
          } catch (error: any) {
            logger.error("Failed to delete batch of emails", {
              error: error.message,
              batchSize: batch.length,
            });
          }
        }
      }

      logger.info(`✅ Total emails deleted: ${totalDeleted}`);
      return totalDeleted;
    } catch (error: any) {
      console.error("=== DELETE EMAILS ERROR ===");
      console.error("Error message:", error.message);
      console.error("Error code:", error.code);
      console.error("Error body:", JSON.stringify(error.body, null, 2));
      console.error("Full error:", error);
      console.error("============================");

      logger.error("Failed to list/delete emails", {
        error: error.message,
        errorCode: error.code,
        errorBody: error.body,
      });
      return totalDeleted;
    }
  }

  /**
   * Get deal by Salesforce Opportunity ID
   */
  async getDealBySalesforceOpportunityId(
    salesforceOpportunityId: string,
  ): Promise<string | null> {
    await this.rateLimiter.waitForToken();

    try {
      const searchResponse = await this.client.crm.deals.searchApi.doSearch({
        filterGroups: [
          {
            filters: [
              {
                propertyName: "hs_salesforceopportunityid",
                operator: "EQ",
                value: salesforceOpportunityId,
              },
            ],
          },
        ],
        limit: 1,
      });

      if (searchResponse.results.length > 0) {
        return searchResponse.results[0].id;
      }

      return null;
    } catch (error: any) {
      logger.error("Failed to find deal by Salesforce Opportunity ID", {
        salesforceOpportunityId,
        error: error.message,
      });
      return null;
    }
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
}

export default new HubSpotLoader();
