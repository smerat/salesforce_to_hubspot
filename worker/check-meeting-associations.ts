#!/usr/bin/env tsx
import database from './src/services/database';
import { Client } from '@hubspot/api-client';
import config from './src/config';

async function checkMeetingAssociations() {
  console.log('Checking meeting associations...\n');

  try {
    const client = new Client({ accessToken: config.hubspot.accessToken });

    // Get a few meeting ID mappings from the database
    const result = await database.query(`
      SELECT
        salesforce_id,
        hubspot_id,
        salesforce_type,
        hubspot_type
      FROM id_mappings
      WHERE hubspot_type = 'meeting'
      LIMIT 5
    `);

    if (result.rows.length === 0) {
      console.log('No meeting mappings found in database.');
      await database.close();
      return;
    }

    console.log(`Found ${result.rows.length} meeting mappings. Checking associations...\n`);

    for (const mapping of result.rows) {
      console.log(`\n=== Meeting: ${mapping.hubspot_id} ===`);
      console.log(`Salesforce Event ID: ${mapping.salesforce_id}`);

      // Get the Salesforce event details
      const eventResult = await database.query(`
        SELECT * FROM salesforce_events WHERE id = $1
      `, [mapping.salesforce_id]);

      if (eventResult.rows.length > 0) {
        const event = eventResult.rows[0];
        console.log(`WhoId (Contact): ${event.whoid || 'None'}`);
        console.log(`WhatId (Company/Deal): ${event.whatid || 'None'}`);
      }

      // Get associations from HubSpot
      try {
        const associations = await client.crm.objects.meetings.associationsApi.getAll(
          mapping.hubspot_id,
          ['contacts', 'companies', 'deals']
        );

        console.log('\nHubSpot Associations:');
        console.log(`- Contacts: ${associations.results.filter((a: any) => a.toObjectId).length}`);
        console.log(`- Companies: ${associations.results.filter((a: any) => a.toObjectId).length}`);
        console.log(`- Deals: ${associations.results.filter((a: any) => a.toObjectId).length}`);

        if (associations.results.length === 0) {
          console.log('❌ NO ASSOCIATIONS FOUND!');
        }
      } catch (error: any) {
        console.error('Error fetching associations:', error.message);
      }
    }

  } catch (error: any) {
    console.error('Error:', error.message);
  }

  await database.close();
}

checkMeetingAssociations();
