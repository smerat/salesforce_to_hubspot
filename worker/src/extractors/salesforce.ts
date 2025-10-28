import jsforce from 'jsforce';
import config from '../config';
import logger from '../utils/logger';
import { retry, RateLimiter } from '../utils/retry';
import {
  ObjectType,
  SalesforceContact,
  SalesforceAccount,
  SalesforceOpportunity,
  SalesforceRecord,
  ExtractResult,
} from '../types';

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

    logger.info('Connecting to Salesforce...');

    this.connection = new jsforce.Connection({
      loginUrl: config.salesforce.loginUrl,
    });

    try {
      await retry(
        async () => {
          await this.connection!.login(
            config.salesforce.username,
            config.salesforce.password + config.salesforce.securityToken
          );
        },
        {
          maxRetries: config.migration.maxRetries,
          delayMs: 2000,
          exponentialBackoff: true,
        }
      );

      this.isConnected = true;
      logger.info('Successfully connected to Salesforce', {
        instanceUrl: this.connection.instanceUrl,
        organizationId: this.connection.userInfo?.organizationId,
      });
    } catch (error) {
      logger.error('Failed to connect to Salesforce', { error });
      throw error;
    }
  }

  /**
   * Get total count of records for an object type
   */
  async getRecordCount(objectType: ObjectType): Promise<number> {
    await this.ensureConnected();

    const soqlObject = this.getSalesforceObjectName(objectType);
    const query = `SELECT COUNT() FROM ${soqlObject}`;

    await this.rateLimiter.waitForToken();

    try {
      const result = await this.connection!.query(query);
      logger.info(`Total ${objectType} count: ${result.totalSize}`);
      return result.totalSize;
    } catch (error) {
      logger.error(`Failed to get count for ${objectType}`, { error });
      throw error;
    }
  }

  /**
   * Extract contacts from Salesforce
   */
  async extractContacts(
    batchSize: number = 200,
    lastId?: string
  ): Promise<ExtractResult> {
    await this.ensureConnected();

    const fields = [
      'Id',
      'FirstName',
      'LastName',
      'Email',
      'Phone',
      'MobilePhone',
      'AccountId',
      'Title',
      'Department',
      'MailingStreet',
      'MailingCity',
      'MailingState',
      'MailingPostalCode',
      'MailingCountry',
      'CreatedDate',
      'LastModifiedDate',
    ];

    let query = `SELECT ${fields.join(', ')} FROM Contact`;

    if (lastId) {
      query += ` WHERE Id > '${lastId}'`;
    }

    query += ` ORDER BY Id ASC LIMIT ${batchSize}`;

    await this.rateLimiter.waitForToken();

    try {
      const result = await this.connection!.query<SalesforceContact>(query);
      const records = result.records;

      logger.info(`Extracted ${records.length} contacts`, {
        lastId: records[records.length - 1]?.Id,
      });

      return {
        records,
        hasMore: records.length === batchSize,
        nextPage: records[records.length - 1]?.Id,
      };
    } catch (error) {
      logger.error('Failed to extract contacts', { error });
      throw error;
    }
  }

  /**
   * Extract accounts (companies) from Salesforce
   */
  async extractAccounts(
    batchSize: number = 200,
    lastId?: string
  ): Promise<ExtractResult> {
    await this.ensureConnected();

    const fields = [
      'Id',
      'Name',
      'Website',
      'Phone',
      'Industry',
      'NumberOfEmployees',
      'AnnualRevenue',
      'Type',
      'BillingStreet',
      'BillingCity',
      'BillingState',
      'BillingPostalCode',
      'BillingCountry',
      'Description',
      'CreatedDate',
      'LastModifiedDate',
    ];

    let query = `SELECT ${fields.join(', ')} FROM Account`;

    if (lastId) {
      query += ` WHERE Id > '${lastId}'`;
    }

    query += ` ORDER BY Id ASC LIMIT ${batchSize}`;

    await this.rateLimiter.waitForToken();

    try {
      const result = await this.connection!.query<SalesforceAccount>(query);
      const records = result.records;

      logger.info(`Extracted ${records.length} accounts`, {
        lastId: records[records.length - 1]?.Id,
      });

      return {
        records,
        hasMore: records.length === batchSize,
        nextPage: records[records.length - 1]?.Id,
      };
    } catch (error) {
      logger.error('Failed to extract accounts', { error });
      throw error;
    }
  }

  /**
   * Extract opportunities (deals) from Salesforce
   */
  async extractOpportunities(
    batchSize: number = 200,
    lastId?: string
  ): Promise<ExtractResult> {
    await this.ensureConnected();

    const fields = [
      'Id',
      'Name',
      'AccountId',
      'Amount',
      'CloseDate',
      'StageName',
      'Probability',
      'Type',
      'LeadSource',
      'Description',
      'CreatedDate',
      'LastModifiedDate',
    ];

    let query = `SELECT ${fields.join(', ')} FROM Opportunity`;

    if (lastId) {
      query += ` WHERE Id > '${lastId}'`;
    }

    query += ` ORDER BY Id ASC LIMIT ${batchSize}`;

    await this.rateLimiter.waitForToken();

    try {
      const result = await this.connection!.query<SalesforceOpportunity>(query);
      const records = result.records;

      logger.info(`Extracted ${records.length} opportunities`, {
        lastId: records[records.length - 1]?.Id,
      });

      return {
        records,
        hasMore: records.length === batchSize,
        nextPage: records[records.length - 1]?.Id,
      };
    } catch (error) {
      logger.error('Failed to extract opportunities', { error });
      throw error;
    }
  }

  /**
   * Generic extract method
   */
  async extract(
    objectType: ObjectType,
    batchSize: number = 200,
    lastId?: string
  ): Promise<ExtractResult> {
    switch (objectType) {
      case 'contacts':
        return this.extractContacts(batchSize, lastId);
      case 'companies':
        return this.extractAccounts(batchSize, lastId);
      case 'deals':
        return this.extractOpportunities(batchSize, lastId);
      default:
        throw new Error(`Unsupported object type: ${objectType}`);
    }
  }

  /**
   * Get Salesforce object name from our object type
   */
  private getSalesforceObjectName(objectType: ObjectType): string {
    const mapping: Record<ObjectType, string> = {
      contacts: 'Contact',
      companies: 'Account',
      deals: 'Opportunity',
      activities: 'Task',
      notes: 'Note',
    };
    return mapping[objectType];
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
   * Disconnect from Salesforce
   */
  async disconnect(): Promise<void> {
    if (this.connection) {
      await this.connection.logout();
      this.connection = null;
      this.isConnected = false;
      logger.info('Disconnected from Salesforce');
    }
  }
}

export default new SalesforceExtractor();
