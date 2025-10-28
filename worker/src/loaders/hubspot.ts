import { Client } from '@hubspot/api-client';
import config from '../config';
import logger from '../utils/logger';
import { retry, RateLimiter } from '../utils/retry';
import {
  HubSpotContact,
  HubSpotCompany,
  HubSpotDeal,
  BatchLoadResult,
  ObjectType,
} from '../types';

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
   * Create a single contact in HubSpot
   */
  async createContact(contact: HubSpotContact): Promise<string> {
    await this.rateLimiter.waitForToken();

    try {
      const result = await retry(
        async () => {
          return await this.client.crm.contacts.basicApi.create({
            properties: contact.properties,
            associations: [],
          });
        },
        {
          maxRetries: config.migration.maxRetries,
          delayMs: 1000,
          exponentialBackoff: true,
          onRetry: (error, attempt) => {
            logger.warn(`Retry creating contact (attempt ${attempt})`, {
              error: error.message,
            });
          },
        }
      );

      logger.debug('Created contact in HubSpot', { id: result.id });
      return result.id;
    } catch (error: any) {
      logger.error('Failed to create contact in HubSpot', {
        error: error.message,
        contact,
      });
      throw error;
    }
  }

  /**
   * Batch create contacts in HubSpot
   */
  async batchCreateContacts(
    contacts: Array<{ salesforceId: string; data: HubSpotContact }>
  ): Promise<BatchLoadResult> {
    if (contacts.length === 0) {
      return { successful: [], failed: [] };
    }

    await this.rateLimiter.waitForToken();

    const successful: Array<{ salesforceId: string; hubspotId: string }> = [];
    const failed: Array<{ salesforceId: string; error: string }> = [];

    // HubSpot batch API supports up to 100 records
    const batchSize = 100;
    const batches = this.chunkArray(contacts, batchSize);

    for (const batch of batches) {
      try {
        const inputs = batch.map((c) => ({
          properties: c.data.properties,
        }));

        const result = await retry(
          async () => {
            return await this.client.crm.contacts.batchApi.create({
              inputs,
            });
          },
          {
            maxRetries: config.migration.maxRetries,
            delayMs: 1000,
          }
        );

        // Map results back to Salesforce IDs
        result.results.forEach((hubspotContact, index) => {
          successful.push({
            salesforceId: batch[index].salesforceId,
            hubspotId: hubspotContact.id,
          });
        });

        logger.info(`Batch created ${result.results.length} contacts in HubSpot`);
      } catch (error: any) {
        // If batch fails, try individual creates
        logger.warn('Batch create failed, trying individual creates', {
          error: error.message,
        });

        for (const contact of batch) {
          try {
            const hubspotId = await this.createContact(contact.data);
            successful.push({
              salesforceId: contact.salesforceId,
              hubspotId,
            });
          } catch (individualError: any) {
            failed.push({
              salesforceId: contact.salesforceId,
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
   * Create a single company in HubSpot
   */
  async createCompany(company: HubSpotCompany): Promise<string> {
    await this.rateLimiter.waitForToken();

    try {
      const result = await retry(
        async () => {
          return await this.client.crm.companies.basicApi.create({
            properties: company.properties,
            associations: [],
          });
        },
        {
          maxRetries: config.migration.maxRetries,
          delayMs: 1000,
          exponentialBackoff: true,
        }
      );

      logger.debug('Created company in HubSpot', { id: result.id });
      return result.id;
    } catch (error: any) {
      logger.error('Failed to create company in HubSpot', {
        error: error.message,
        company,
      });
      throw error;
    }
  }

  /**
   * Batch create companies in HubSpot
   */
  async batchCreateCompanies(
    companies: Array<{ salesforceId: string; data: HubSpotCompany }>
  ): Promise<BatchLoadResult> {
    if (companies.length === 0) {
      return { successful: [], failed: [] };
    }

    await this.rateLimiter.waitForToken();

    const successful: Array<{ salesforceId: string; hubspotId: string }> = [];
    const failed: Array<{ salesforceId: string; error: string }> = [];

    const batchSize = 100;
    const batches = this.chunkArray(companies, batchSize);

    for (const batch of batches) {
      try {
        const inputs = batch.map((c) => ({
          properties: c.data.properties,
        }));

        const result = await retry(
          async () => {
            return await this.client.crm.companies.batchApi.create({
              inputs,
            });
          },
          {
            maxRetries: config.migration.maxRetries,
            delayMs: 1000,
          }
        );

        result.results.forEach((hubspotCompany, index) => {
          successful.push({
            salesforceId: batch[index].salesforceId,
            hubspotId: hubspotCompany.id,
          });
        });

        logger.info(`Batch created ${result.results.length} companies in HubSpot`);
      } catch (error: any) {
        logger.warn('Batch create failed, trying individual creates', {
          error: error.message,
        });

        for (const company of batch) {
          try {
            const hubspotId = await this.createCompany(company.data);
            successful.push({
              salesforceId: company.salesforceId,
              hubspotId,
            });
          } catch (individualError: any) {
            failed.push({
              salesforceId: company.salesforceId,
              error: individualError.message,
            });
          }
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return { successful, failed };
  }

  /**
   * Create a single deal in HubSpot
   */
  async createDeal(deal: HubSpotDeal): Promise<string> {
    await this.rateLimiter.waitForToken();

    try {
      const result = await retry(
        async () => {
          return await this.client.crm.deals.basicApi.create({
            properties: deal.properties,
            associations: deal.associations || [],
          });
        },
        {
          maxRetries: config.migration.maxRetries,
          delayMs: 1000,
          exponentialBackoff: true,
        }
      );

      logger.debug('Created deal in HubSpot', { id: result.id });
      return result.id;
    } catch (error: any) {
      logger.error('Failed to create deal in HubSpot', {
        error: error.message,
        deal,
      });
      throw error;
    }
  }

  /**
   * Batch create deals in HubSpot
   */
  async batchCreateDeals(
    deals: Array<{ salesforceId: string; data: HubSpotDeal }>
  ): Promise<BatchLoadResult> {
    if (deals.length === 0) {
      return { successful: [], failed: [] };
    }

    await this.rateLimiter.waitForToken();

    const successful: Array<{ salesforceId: string; hubspotId: string }> = [];
    const failed: Array<{ salesforceId: string; error: string }> = [];

    const batchSize = 100;
    const batches = this.chunkArray(deals, batchSize);

    for (const batch of batches) {
      try {
        const inputs = batch.map((d) => ({
          properties: d.data.properties,
          associations: d.data.associations || [],
        }));

        const result = await retry(
          async () => {
            return await this.client.crm.deals.batchApi.create({
              inputs,
            });
          },
          {
            maxRetries: config.migration.maxRetries,
            delayMs: 1000,
          }
        );

        result.results.forEach((hubspotDeal, index) => {
          successful.push({
            salesforceId: batch[index].salesforceId,
            hubspotId: hubspotDeal.id,
          });
        });

        logger.info(`Batch created ${result.results.length} deals in HubSpot`);
      } catch (error: any) {
        logger.warn('Batch create failed, trying individual creates', {
          error: error.message,
        });

        for (const deal of batch) {
          try {
            const hubspotId = await this.createDeal(deal.data);
            successful.push({
              salesforceId: deal.salesforceId,
              hubspotId,
            });
          } catch (individualError: any) {
            failed.push({
              salesforceId: deal.salesforceId,
              error: individualError.message,
            });
          }
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return { successful, failed };
  }

  /**
   * Create association between two HubSpot objects
   */
  async createAssociation(
    fromObjectType: string,
    fromObjectId: string,
    toObjectType: string,
    toObjectId: string,
    associationTypeId: number
  ): Promise<void> {
    await this.rateLimiter.waitForToken();

    try {
      await retry(
        async () => {
          await this.client.crm.associations.batchApi.create(
            fromObjectType as any,
            toObjectType as any,
            {
              inputs: [
                {
                  from: { id: fromObjectId },
                  to: { id: toObjectId },
                  type: associationTypeId,
                },
              ],
            }
          );
        },
        {
          maxRetries: config.migration.maxRetries,
          delayMs: 1000,
        }
      );

      logger.debug('Created association in HubSpot', {
        from: `${fromObjectType}:${fromObjectId}`,
        to: `${toObjectType}:${toObjectId}`,
      });
    } catch (error: any) {
      logger.error('Failed to create association in HubSpot', {
        error: error.message,
        fromObjectType,
        fromObjectId,
        toObjectType,
        toObjectId,
      });
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
