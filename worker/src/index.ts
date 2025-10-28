#!/usr/bin/env node

import logger from './utils/logger';
import migrator from './services/migrator';
import database from './services/database';
import { ObjectType } from './types';

/**
 * Main entry point for the migration worker
 */
async function main() {
  const args = process.argv.slice(2);

  // Parse command line arguments
  const command = args[0];
  const objectArg = args.find((arg) => arg.startsWith('--object='));
  const runIdArg = args.find((arg) => arg.startsWith('--run-id='));

  logger.info('🔧 Salesforce to HubSpot Migration Worker');
  logger.info('==========================================');

  try {
    if (command === 'resume' && runIdArg) {
      // Resume a migration run
      const runId = runIdArg.split('=')[1];
      await migrator.resumeMigration(runId);
    } else if (objectArg) {
      // Start a new migration for specific object types
      const objectTypes = objectArg
        .split('=')[1]
        .split(',')
        .map((s) => s.trim()) as ObjectType[];

      logger.info('Starting migration for:', objectTypes);
      await migrator.startMigration(objectTypes);
    } else {
      // Default: migrate all supported object types
      logger.info('Starting full migration (all object types)');
      await migrator.startMigration(['companies', 'contacts', 'deals']);
    }

    logger.info('✅ Migration completed successfully');
    process.exit(0);
  } catch (error: any) {
    logger.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    // Cleanup
    await database.close();
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.warn('Received SIGINT, stopping migration...');
  migrator.stop();
  await database.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.warn('Received SIGTERM, stopping migration...');
  migrator.stop();
  await database.close();
  process.exit(0);
});

// Start the application
main().catch((error) => {
  logger.error('Unhandled error:', error);
  process.exit(1);
});
