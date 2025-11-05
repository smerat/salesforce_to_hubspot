#!/usr/bin/env tsx
import database from './src/services/database';

async function checkOwnerMappings() {
  const runId = '18ec8cf5-d3a0-465c-8b7c-252de92be2c4';

  console.log(`Checking owner mappings for migration: ${runId}\n`);

  try {
    const mappings = await database.query(`
      SELECT * FROM owner_mappings
      WHERE run_id = $1
    `, [runId]);

    console.log(`Found ${mappings.rows.length} existing owner mapping(s)`);

    if (mappings.rows.length > 0) {
      console.log('\nDeleting old mappings...');
      await database.query(`
        DELETE FROM owner_mappings WHERE run_id = $1
      `, [runId]);
      console.log('✅ Deleted old mappings');
    }

    // Also check progress
    const progress = await database.query(`
      SELECT * FROM migration_progress WHERE run_id = $1
    `, [runId]);

    if (progress.rows.length > 0) {
      console.log(`\nFound ${progress.rows.length} progress record(s)`);
      console.log('Deleting old progress...');
      await database.query(`
        DELETE FROM migration_progress WHERE run_id = $1
      `, [runId]);
      console.log('✅ Deleted old progress');
    }

  } catch (error: any) {
    console.error('Error:', error.message);
  }

  await database.close();
}

checkOwnerMappings();
