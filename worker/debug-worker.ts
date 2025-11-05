#!/usr/bin/env tsx
import logger from './src/utils/logger';
import database from './src/services/database';

async function debugWorker() {
  console.log('🔍 Debug Worker - Checking for migrations...\n');

  try {
    // Check for queued migrations
    const queuedRuns = await database.getQueuedMigrationRuns();

    if (queuedRuns.length === 0) {
      console.log('No queued migrations found.');
      console.log('\nChecking all recent migrations:');

      const all = await database.query(`
        SELECT id, status, started_at
        FROM migration_runs
        ORDER BY started_at DESC
        LIMIT 5
      `);

      all.rows.forEach((row: any) => {
        console.log(`  ${row.id.slice(0, 8)} - ${row.status} - ${row.started_at}`);
      });
    } else {
      console.log(`✅ Found ${queuedRuns.length} queued migration(s)\n`);

      for (const run of queuedRuns) {
        console.log(`Migration ID: ${run.id}`);
        console.log(`Status: ${run.status}`);
        console.log(`Config:`, run.config_snapshot);
        console.log('---');
      }
    }

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error(error);
  }

  await database.close();
}

debugWorker();
