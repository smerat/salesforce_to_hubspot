#!/usr/bin/env tsx
import database from './src/services/database';
import salesforceExtractor from './src/extractors/salesforce';
import { Client } from '@hubspot/api-client';
import config from './src/config';

async function testConnections() {
  console.log('Testing connections...\n');

  // Test 1: Database
  console.log('1. Testing Supabase database...');
  try {
    const result = await database.query('SELECT NOW() as time');
    console.log('✅ Database connected:', result.rows[0].time);
  } catch (error: any) {
    console.error('❌ Database error:', error.message);
  }

  // Test 2: Check for queued migrations
  console.log('\n2. Checking for queued migrations...');
  try {
    const runs = await database.getQueuedMigrationRuns();
    console.log(`✅ Found ${runs.length} queued migration(s)`);
    if (runs.length > 0) {
      console.log('   First queued run:', {
        id: runs[0].id,
        status: runs[0].status,
        started_at: runs[0].started_at,
      });
    }
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }

  // Test 3: Salesforce
  console.log('\n3. Testing Salesforce connection...');
  try {
    await salesforceExtractor.connect();
    console.log('✅ Salesforce connected');

    const count = await salesforceExtractor.getRecordCount('Account');
    console.log(`   Found ${count} Accounts`);

    await salesforceExtractor.disconnect();
  } catch (error: any) {
    console.error('❌ Salesforce error:', error.message);
    console.error('   Details:', error);
  }

  // Test 4: HubSpot
  console.log('\n4. Testing HubSpot connection...');
  try {
    const client = new Client({
      accessToken: config.hubspot.accessToken,
    });
    const response = await client.crm.owners.ownersApi.getPage();
    console.log(`✅ HubSpot connected`);
    console.log(`   Found ${response.results.length} owners`);
  } catch (error: any) {
    console.error('❌ HubSpot error:', error.message);
    console.error('   Details:', error);
  }

  console.log('\n✅ Connection tests complete');
  await database.close();
  process.exit(0);
}

testConnections().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
