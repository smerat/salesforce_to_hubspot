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

    // Keep searching and deleting until no more meetings are found
    while (hasMore) {
      // Search for meetings
      const searchResponse =
        await client.crm.objects.meetings.searchApi.doSearch({
          filterGroups: [],
          limit: 100,
        });

      const meetingIds = searchResponse.results.map((item) => item.id);

      if (meetingIds.length === 0) {
        hasMore = false;
        break;
      }

      console.log(`Found ${meetingIds.length} meetings to delete`);

      const batchSize = 100;
      for (let i = 0; i < meetingIds.length; i += batchSize) {
        const batch = meetingIds.slice(i, i + batchSize);

        await client.crm.objects.meetings.batchApi.archive({
          inputs: batch.map((id) => ({ id })),
        });
        deletedCount += batch.length;
        console.log(
          `Deleted ${batch.length} meetings (total so far: ${deletedCount})`,
        );
      }

      // If we got fewer than 100, we're done
      if (meetingIds.length < 100) {
        hasMore = false;
      }
    }

    console.log(`Total meetings deleted: ${deletedCount}`);

    return NextResponse.json({
      success: true,
      deletedCount,
      message: `Successfully deleted ${deletedCount} meetings from HubSpot`,
    });
  } catch (error: any) {
    console.error("Failed to delete meetings:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete meetings" },
      { status: 500 },
    );
  }
}
