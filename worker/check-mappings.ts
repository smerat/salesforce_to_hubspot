import database from "./src/services/database";

async function checkMappings() {
  console.log("Checking for specific RelationIds in id_mappings...\n");

  const relationIds = ["001ON00000RDYu0YAH", "003ON00000UUWqUYAX"];

  const mappings = await database.bulkGetIdMappings(relationIds);

  console.log(`Found ${mappings.length} mappings out of ${relationIds.length} RelationIds:\n`);

  for (const relationId of relationIds) {
    const mapping = mappings.find((m) => m.salesforce_id === relationId);
    if (mapping) {
      console.log(`✓ ${relationId}:`);
      console.log(`  Salesforce Type: ${mapping.salesforce_type}`);
      console.log(`  HubSpot ID: ${mapping.hubspot_id}`);
      console.log(`  HubSpot Type: ${mapping.hubspot_type}\n`);
    } else {
      console.log(`✗ ${relationId}: NO MAPPING FOUND\n`);
    }
  }

  console.log("\nChecking total mappings by type:");
  const allMappings = await database.query(
    "SELECT hubspot_type, COUNT(*) as count FROM id_mappings GROUP BY hubspot_type ORDER BY count DESC",
  );
  console.log(allMappings.rows);

  process.exit(0);
}

checkMappings().catch(console.error);
