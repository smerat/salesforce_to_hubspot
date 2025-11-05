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
      // We need to find both "Renewed In" and "Renewal of" labels
      const renewedInLabel: any = result.results.find(
        (label: any) =>
          label.label?.toLowerCase() === "renewed in" &&
          label.category === "USER_DEFINED",
      );

      const renewalOfLabel: any = result.results.find(
        (label: any) =>
          label.label?.toLowerCase() === "renewal of" &&
          label.category === "USER_DEFINED",
      );

      if (renewedInLabel && renewalOfLabel) {
        logger.info("Found bidirectional association labels", {
          renewedIn: {
            typeId: renewedInLabel.typeId,
            label: renewedInLabel.label,
          },
          renewalOf: {
            typeId: renewalOfLabel.typeId,
            label: renewalOfLabel.label,
          },
        });

        return {
          forward: parseInt(renewedInLabel.typeId),
          reverse: parseInt(renewalOfLabel.typeId),
        };
      }

      logger.warn("Association labels not found", {
        labelName,
        availableLabels: result.results.map((r: any) => r.label),
        foundRenewedIn: !!renewedInLabel,
        foundRenewalOf: !!renewalOfLabel,
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
