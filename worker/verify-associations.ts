import { Client } from "@hubspot/api-client";
import * as dotenv from "dotenv";

dotenv.config();

const client = new Client({
  accessToken: process.env.HUBSPOT_ACCESS_TOKEN!,
});

async function verifyAssociations(dealId: string) {
  try {
    console.log(`\n=== Checking Deal ${dealId} ===\n`);

    // Get the deal details
    const deal = await client.crm.deals.basicApi.getById(dealId, [
      "dealname",
      "hs_salesforceopportunityid",
    ]);

    console.log("Deal Details:");
    console.log(`  Name: ${deal.properties.dealname}`);
    console.log(
      `  Salesforce Opportunity ID: ${deal.properties.hs_salesforceopportunityid}`,
    );

    // Get all associations for this deal using v4 API
    console.log("\n=== All Deal Associations ===\n");

    try {
      const associations = await client.crm.associations.v4.basicApi.getPage(
        "deals",
        dealId,
        "deals",
      );

      if (associations.results && associations.results.length > 0) {
        console.log(
          `Found ${associations.results.length} deal-to-deal associations:\n`,
        );

        for (const assoc of associations.results) {
          console.log(`  Associated Deal ID: ${assoc.toObjectId}`);
          console.log(
            `  Association Type ID: ${assoc.associationTypes?.[0]?.typeId || "N/A"}`,
          );
          console.log(
            `  Association Label: ${assoc.associationTypes?.[0]?.label || "N/A"}`,
          );

          // Get details of the associated deal
          try {
            const associatedDeal = await client.crm.deals.basicApi.getById(
              assoc.toObjectId.toString(),
              ["dealname", "hs_salesforceopportunityid"],
            );
            console.log(`    Name: ${associatedDeal.properties.dealname}`);
            console.log(
              `    Salesforce Opportunity ID: ${associatedDeal.properties.hs_salesforceopportunityid}`,
            );
          } catch (err) {
            console.log(`    Could not fetch associated deal details`);
          }
          console.log();
        }
      } else {
        console.log("No deal-to-deal associations found for this deal.");
      }
    } catch (err: any) {
      console.error("Error fetching associations:", err.message);
      if (err.body) {
        console.error("Error details:", JSON.stringify(err.body, null, 2));
      }
    }
  } catch (error: any) {
    console.error("Error:", error.message);
    if (error.body) {
      console.error("Details:", JSON.stringify(error.body, null, 2));
    }
  }
}

// Run the verification
const dealId = process.argv[2] || "122356660178";
verifyAssociations(dealId);
