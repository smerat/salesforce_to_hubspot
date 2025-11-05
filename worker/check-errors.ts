#!/usr/bin/env tsx
import database from './src/services/database';

async function checkErrors() {
  const runId = '18ec8cf5-d3a0-465c-8b7c-252de92be2c4';

  console.log(`Checking errors for migration: ${runId}\n`);

  try {
    const errors = await database.query(`
      SELECT
        id,
        object_type,
        salesforce_id,
        error_message,
        created_at
      FROM migration_errors
      WHERE run_id = $1
      ORDER BY created_at DESC
      LIMIT 10
    `, [runId]);

    if (errors.rows.length === 0) {
      console.log('No errors found.');
    } else {
      console.log(`Found ${errors.rows.length} error(s):\n`);
      errors.rows.forEach((row: any) => {
        console.log(`Time: ${row.created_at}`);
        console.log(`Object: ${row.object_type}`);
        console.log(`SF ID: ${row.salesforce_id}`);
        console.log(`Error: ${row.error_message}`);
        console.log('---');
      });
    }

    // Check progress
    console.log('\nProgress:');
    const progress = await database.query(`
      SELECT * FROM migration_progress
      WHERE run_id = $1
    `, [runId]);

    if (progress.rows.length > 0) {
      progress.rows.forEach((row: any) => {
        console.log(`${row.object_type}: ${row.processed_records}/${row.total_records} (${row.failed_records} failed)`);
      });
    } else {
      console.log('No progress records found.');
    }

  } catch (error: any) {
    console.error('Error:', error.message);
  }

  await database.close();
}

checkErrors();
