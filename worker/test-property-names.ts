import { Client } from "@hubspot/api-client";
import * as dotenv from "dotenv";

dotenv.config();

async function testPropertyNames() {
  const client = new Client({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN });

  console.log("\n=== Testing HubSpot Property Names ===\n");

  // Test 1: Get one contact and check what Salesforce ID property it has
  console.log("1. Fetching a sample contact...");
  try {
    const contacts = await client.crm.contacts.basicApi.getPage(1);
    if (contacts.results.length > 0) {
      const contact = contacts.results[0];
      console.log("Contact ID:", contact.id);
      console.log("Properties:", JSON.stringify(contact.properties, null, 2));

      // Check for various Salesforce ID property names
      const possibleNames = [
        'salesforcecontactid',
        'salesforce_contact_id',
        'hs_object_source_id',
        'salesforce_id',
        'sfdc_contact_id'
      ];

      console.log("\nChecking for Salesforce ID properties:");
      for (const name of possibleNames) {
        if (contact.properties[name]) {
          console.log(`✓ Found: ${name} = ${contact.properties[name]}`);
        }
      }
    }
  } catch (error: any) {
    console.error("Error fetching contact:", error.message);
  }

  // Test 2: Get one company
  console.log("\n2. Fetching a sample company...");
  try {
    const companies = await client.crm.companies.basicApi.getPage(1);
    if (companies.results.length > 0) {
      const company = companies.results[0];
      console.log("Company ID:", company.id);
      console.log("Properties:", JSON.stringify(company.properties, null, 2));

      const possibleNames = [
        'salesforceaccountid',
        'salesforce_account_id',
        'hs_object_source_id',
        'salesforce_id',
        'sfdc_account_id'
      ];

      console.log("\nChecking for Salesforce ID properties:");
      for (const name of possibleNames) {
        if (company.properties[name]) {
          console.log(`✓ Found: ${name} = ${company.properties[name]}`);
        }
      }
    }
  } catch (error: any) {
    console.error("Error fetching company:", error.message);
  }

  // Test 3: Try searching for a specific Salesforce ID
  console.log("\n3. Testing search with known Salesforce IDs from logs...");
  const testContactId = '0034x000006JvSU';
  const testAccountId = '0014x00000BJ4ZU';

  try {
    console.log(`\nSearching for contact with salesforcecontactid = ${testContactId}`);
    const searchResult = await client.crm.contacts.searchApi.doSearch({
      filterGroups: [{
        filters: [{
          propertyName: "salesforcecontactid",
          operator: "EQ",
          value: testContactId,
        }],
      }],
      properties: ["salesforcecontactid", "firstname", "lastname"],
      limit: 1,
    });
    console.log("Results found:", searchResult.results.length);
    if (searchResult.results.length > 0) {
      console.log("Match found:", searchResult.results[0]);
    }
  } catch (error: any) {
    console.error("Search error:", error.message);
  }
}

testPropertyNames().catch(console.error);
