#!/usr/bin/env tsx
import database from './src/services/database';

async function checkProgress() {
  const runId = '18ec8cf5-d3a0-465c-8b7c-252de92be2c4';
  
  const progress = await database.query(`
    SELECT * FROM migration_progress WHERE run_id = $1
  `, [runId]);

  console.log(`Found ${progress.rows.length} progress record(s):`);
  progress.rows.forEach((row: any) => {
    console.log(row);
  });

  if (progress.rows.length > 0) {
    console.log('\nDeleting...');
    await database.query(`DELETE FROM migration_progress WHERE run_id = $1`, [runId]);
    console.log('✅ Deleted');
  }

  await database.close();
}

checkProgress();
