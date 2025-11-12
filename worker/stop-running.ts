#!/usr/bin/env tsx
import database from './src/services/database';

async function stopRunning() {
  console.log('Stopping running migrations...\n');

  try {
    const result = await database.query(`
      UPDATE migration_runs
      SET status = 'failed',
          completed_at = NOW(),
          notes = 'Manually stopped to apply code changes'
      WHERE status = 'running'
      RETURNING id, status
    `);

    if (result.rows.length === 0) {
      console.log('No running migrations found.');
    } else {
      console.log(`✅ Stopped ${result.rows.length} migration(s):\n`);
      result.rows.forEach((row: any) => {
        console.log(`ID: ${row.id}`);
        console.log(`Status: ${row.status}`);
        console.log('---');
      });
    }

  } catch (error: any) {
    console.error('Error:', error.message);
  }

  await database.close();
}

stopRunning();
