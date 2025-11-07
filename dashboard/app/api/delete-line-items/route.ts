import { NextResponse } from "next/server";
import { Client } from "@hubspot/api-client";

export async function POST(request: Request) {
  try {
    const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!;

    if (!HUBSPOT_ACCESS_TOKEN) {
      return NextResponse.json(
        { error: "HubSpot access token not configured" },
        { status: 500 },
      );
    }

    const client = new Client({ accessToken: HUBSPOT_ACCESS_TOKEN });

    // Search for all line items
    const searchResponse = await client.crm.lineItems.searchApi.doSearch({
      filterGroups: [],
      limit: 100,
    });

    let deletedCount = 0;
    const lineItemIds = searchResponse.results.map((item) => item.id);

    if (lineItemIds.length > 0) {
      console.log(`Found ${lineItemIds.length} line items to delete`);

      const batchSize = 100;
      for (let i = 0; i < lineItemIds.length; i += batchSize) {
        const batch = lineItemIds.slice(i, i + batchSize);

        await client.crm.lineItems.batchApi.archive({
          inputs: batch.map((id) => ({ id })),
        });
        deletedCount += batch.length;
        console.log(`Deleted ${batch.length} line items`);
      }
    }

    console.log(`Total line items deleted: ${deletedCount}`);

    return NextResponse.json({
      success: true,
      deletedCount,
      message: `Successfully deleted ${deletedCount} line items from HubSpot`,
    });
  } catch (error: any) {
    console.error("Failed to delete line items:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete line items" },
      { status: 500 },
    );
  }
}
