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

    let deletedCount = 0;
    let hasMore = true;

    // Keep searching and deleting until no more emails are found
    while (hasMore) {
      // Search for emails
      const searchResponse =
        await client.crm.objects.emails.searchApi.doSearch({
          filterGroups: [],
          limit: 100,
        });

      const emailIds = searchResponse.results.map((item) => item.id);

      if (emailIds.length === 0) {
        hasMore = false;
        break;
      }

      console.log(`Found ${emailIds.length} emails to delete`);

      const batchSize = 100;
      for (let i = 0; i < emailIds.length; i += batchSize) {
        const batch = emailIds.slice(i, i + batchSize);

        await client.crm.objects.emails.batchApi.archive({
          inputs: batch.map((id) => ({ id })),
        });
        deletedCount += batch.length;
        console.log(
          `Deleted ${batch.length} emails (total so far: ${deletedCount})`,
        );
      }

      // If we got fewer than 100, we're done
      if (emailIds.length < 100) {
        hasMore = false;
      }
    }

    console.log(`Total emails deleted: ${deletedCount}`);

    return NextResponse.json({
      success: true,
      deletedCount,
      message: `Successfully deleted ${deletedCount} emails from HubSpot`,
    });
  } catch (error: any) {
    console.error("Failed to delete emails:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete emails" },
      { status: 500 },
    );
  }
}
