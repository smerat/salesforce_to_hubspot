import logger from '../utils/logger';
import config from '../config';
import database from './database';
import salesforceExtractor from '../extractors/salesforce';
import hubspotLoader from '../loaders/hubspot';
import transformer from '../transformers';
import { ObjectType, MigrationRun } from '../types';

class Migrator {
  private runId: string | null = null;
  private shouldStop: boolean = false;

  /**
   * Start a new migration run
   */
  async startMigration(objectTypes: ObjectType[]): Promise<void> {
    logger.info('🚀 Starting migration', { objectTypes });

    try {
      // Create migration run
      const run = await database.createMigrationRun('running', {
        objectTypes,
        batchSize: config.migration.batchSize,
        timestamp: new Date().toISOString(),
      });

      this.runId = run.id;
      logger.info(`Created migration run: ${this.runId}`);

      // Create progress tracking for each object type
      for (const objectType of objectTypes) {
        await database.createMigrationProgress(this.runId, objectType, 'pending');
      }

      await database.createAuditLog(
        this.runId,
        'migration_started',
        undefined,
        undefined,
        { objectTypes }
      );

      // Connect to Salesforce
      await salesforceExtractor.connect();

      // Migrate in order: companies -> contacts -> deals
      const migrationOrder: ObjectType[] = [];
      if (objectTypes.includes('companies')) migrationOrder.push('companies');
      if (objectTypes.includes('contacts')) migrationOrder.push('contacts');
      if (objectTypes.includes('deals')) migrationOrder.push('deals');

      for (const objectType of migrationOrder) {
        if (this.shouldStop) {
          logger.warn('Migration stopped by user');
          break;
        }

        await this.migrateObjectType(objectType);
      }

      // Mark migration as completed
      await database.updateMigrationRun(this.runId, {
        status: 'completed',
        completed_at: new Date(),
      });

      await database.createAuditLog(this.runId, 'migration_completed');

      logger.info('✅ Migration completed successfully');
    } catch (error: any) {
      logger.error('❌ Migration failed', { error: error.message });

      if (this.runId) {
        await database.updateMigrationRun(this.runId, {
          status: 'failed',
          completed_at: new Date(),
          notes: error.message,
        });

        await database.createAuditLog(this.runId, 'migration_failed', undefined, undefined, {
          error: error.message,
        });
      }

      throw error;
    } finally {
      // Cleanup
      await salesforceExtractor.disconnect();
    }
  }

  /**
   * Migrate a specific object type
   */
  private async migrateObjectType(objectType: ObjectType): Promise<void> {
    if (!this.runId) {
      throw new Error('No active migration run');
    }

    logger.info(`📦 Starting migration for ${objectType}`);

    try {
      // Update progress status
      await database.updateMigrationProgress(this.runId, objectType, {
        status: 'in_progress',
        started_at: new Date(),
      });

      // Get total count
      const totalRecords = await salesforceExtractor.getRecordCount(objectType);
      await database.updateMigrationProgress(this.runId, objectType, {
        total_records: totalRecords,
      });

      logger.info(`Total ${objectType} to migrate: ${totalRecords}`);

      // Check if we should resume from a previous run
      const progress = await database.getMigrationProgress(this.runId, objectType);
      let lastId = progress?.last_sf_id_processed;

      let hasMore = true;
      let processedCount = progress?.processed_records || 0;

      while (hasMore && !this.shouldStop) {
        // Extract batch from Salesforce
        const extractResult = await salesforceExtractor.extract(
          objectType,
          config.migration.batchSize,
          lastId
        );

        logger.info(`Extracted ${extractResult.records.length} ${objectType} from Salesforce`);

        if (extractResult.records.length === 0) {
          break;
        }

        // Transform and load
        await this.processBatch(objectType, extractResult.records);

        // Update progress
        processedCount += extractResult.records.length;
        lastId = extractResult.nextPage;
        hasMore = extractResult.hasMore;

        await database.updateMigrationProgress(this.runId, objectType, {
          processed_records: processedCount,
          last_sf_id_processed: lastId,
        });

        logger.info(`Progress: ${processedCount}/${totalRecords} ${objectType} processed`);
      }

      // Mark as completed
      await database.updateMigrationProgress(this.runId, objectType, {
        status: 'completed',
        completed_at: new Date(),
      });

      await database.createAuditLog(
        this.runId,
        'object_migration_completed',
        objectType,
        processedCount
      );

      logger.info(`✅ Completed migration for ${objectType}: ${processedCount} records`);
    } catch (error: any) {
      logger.error(`❌ Failed to migrate ${objectType}`, { error: error.message });

      await database.updateMigrationProgress(this.runId, objectType, {
        status: 'failed',
        completed_at: new Date(),
      });

      await database.createAuditLog(
        this.runId,
        'object_migration_failed',
        objectType,
        undefined,
        { error: error.message }
      );

      throw error;
    }
  }

  /**
   * Process a batch of records
   */
  private async processBatch(objectType: ObjectType, records: any[]): Promise<void> {
    if (!this.runId) {
      throw new Error('No active migration run');
    }

    const transformedRecords: Array<{ salesforceId: string; data: any }> = [];
    const failedRecords: Array<{ salesforceId: string; error: string }> = [];

    // Transform records
    for (const record of records) {
      const transformResult = transformer.transform(objectType, record, {
        // For deals, we need to look up the HubSpot company ID
        accountHubSpotId:
          objectType === 'deals' && record.AccountId
            ? await database.getHubSpotId(record.AccountId, 'Account')
            : undefined,
      });

      if (transformResult.success) {
        transformedRecords.push({
          salesforceId: record.Id,
          data: transformResult.data,
        });
      } else {
        failedRecords.push({
          salesforceId: record.Id,
          error: transformResult.error || 'Transformation failed',
        });

        // Log error
        await database.createMigrationError(
          this.runId,
          objectType,
          record.Id,
          record.attributes?.type || 'Unknown',
          transformResult.error || 'Transformation failed'
        );
      }
    }

    // Load to HubSpot in batch
    if (transformedRecords.length > 0) {
      let loadResult;

      switch (objectType) {
        case 'contacts':
          loadResult = await hubspotLoader.batchCreateContacts(transformedRecords);
          break;
        case 'companies':
          loadResult = await hubspotLoader.batchCreateCompanies(transformedRecords);
          break;
        case 'deals':
          loadResult = await hubspotLoader.batchCreateDeals(transformedRecords);
          break;
        default:
          throw new Error(`Unsupported object type: ${objectType}`);
      }

      // Store ID mappings for successful records
      if (loadResult.successful.length > 0) {
        await database.bulkCreateIdMappings(
          loadResult.successful.map((item) => ({
            runId: this.runId!,
            salesforceId: item.salesforceId,
            salesforceType: this.getSalesforceType(objectType),
            hubspotId: item.hubspotId,
            hubspotType: this.getHubSpotType(objectType),
          }))
        );

        logger.info(`Successfully loaded ${loadResult.successful.length} ${objectType} to HubSpot`);
      }

      // Log failed loads
      for (const failed of loadResult.failed) {
        await database.createMigrationError(
          this.runId,
          objectType,
          failed.salesforceId,
          this.getSalesforceType(objectType),
          failed.error
        );
      }

      if (loadResult.failed.length > 0) {
        await database.incrementFailedRecords(this.runId, objectType, loadResult.failed.length);
        logger.warn(`Failed to load ${loadResult.failed.length} ${objectType} to HubSpot`);
      }
    }

    // Update failed record count for transformation failures
    if (failedRecords.length > 0) {
      await database.incrementFailedRecords(this.runId, objectType, failedRecords.length);
      logger.warn(`Failed to transform ${failedRecords.length} ${objectType}`);
    }
  }

  /**
   * Get Salesforce object type name
   */
  private getSalesforceType(objectType: ObjectType): string {
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
   * Get HubSpot object type name
   */
  private getHubSpotType(objectType: ObjectType): string {
    const mapping: Record<ObjectType, string> = {
      contacts: 'contact',
      companies: 'company',
      deals: 'deal',
      activities: 'task',
      notes: 'note',
    };
    return mapping[objectType];
  }

  /**
   * Stop the migration
   */
  stop(): void {
    logger.warn('Stopping migration...');
    this.shouldStop = true;
  }

  /**
   * Resume a migration run
   */
  async resumeMigration(runId: string): Promise<void> {
    logger.info('Resuming migration', { runId });

    const run = await database.getMigrationRun(runId);
    if (!run) {
      throw new Error(`Migration run ${runId} not found`);
    }

    this.runId = runId;

    // Update status to running
    await database.updateMigrationRun(runId, { status: 'running' });

    // Get all progress records
    const progressRecords = await database.getAllMigrationProgress(runId);

    // Resume incomplete migrations
    for (const progress of progressRecords) {
      if (progress.status !== 'completed' && !this.shouldStop) {
        await this.migrateObjectType(progress.object_type);
      }
    }

    // Mark as completed
    await database.updateMigrationRun(runId, {
      status: 'completed',
      completed_at: new Date(),
    });

    logger.info('✅ Migration resumed and completed');
  }
}

export default new Migrator();
