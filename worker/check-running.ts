#!/usr/bin/env tsx
import database from './src/services/database';

async function checkRunning() {
  console.log('Checking running migrations...\n');

  try {
    const result = await database.query(`
      SELECT
        id,
        status,
        started_at,
        completed_at,
        config_snapshot->>'testMode' as test_mode,
        notes
      FROM migration_runs
      WHERE status = 'running'
      ORDER BY started_at DESC
    `);

    if (result.rows.length === 0) {
      console.log('No running migrations found.');
    } else {
      console.log(`Found ${result.rows.length} running migration(s):\n`);
      result.rows.forEach((row: any) => {
        console.log(`ID: ${row.id}`);
        console.log(`Status: ${row.status}`);
        console.log(`Started: ${row.started_at}`);
        console.log(`Test Mode: ${row.test_mode}`);
        console.log(`Notes: ${row.notes}`);
        console.log('---');
      });
    }

    // Check all recent migrations
    console.log('\nAll recent migrations:');
    const allResult = await database.query(`
      SELECT
        id,
        status,
        started_at,
        config_snapshot->>'testMode' as test_mode
      FROM migration_runs
      ORDER BY started_at DESC
      LIMIT 5
    `);

    allResult.rows.forEach((row: any) => {
      console.log(`${row.id.slice(0, 8)} - ${row.status} - Test: ${row.test_mode} - ${row.started_at}`);
    });

  } catch (error: any) {
    console.error('Error:', error.message);
  }

  await database.close();
}

checkRunning();
