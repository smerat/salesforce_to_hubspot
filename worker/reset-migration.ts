#!/usr/bin/env tsx
import database from './src/services/database';

async function resetMigration() {
  const runId = '18ec8cf5-d3a0-465c-8b7c-252de92be2c4';

  console.log(`Resetting migration: ${runId}\n`);

  try {
    // Update status back to queued
    await database.updateMigrationRun(runId, {
      status: 'queued',
      completed_at: undefined,
    });

    console.log('✅ Migration reset to queued status');
    console.log('   The worker will pick it up again on next poll');

  } catch (error: any) {
    console.error('Error:', error.message);
  }

  await database.close();
}

resetMigration();
