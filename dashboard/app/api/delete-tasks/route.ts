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

    // Keep searching and deleting until no more tasks are found
    while (hasMore) {
      // Search for tasks
      const searchResponse = await client.crm.objects.tasks.searchApi.doSearch({
        filterGroups: [],
        limit: 100,
      });

      const taskIds = searchResponse.results.map((item) => item.id);

      if (taskIds.length === 0) {
        hasMore = false;
        break;
      }

      console.log(`Found ${taskIds.length} tasks to delete`);

      const batchSize = 100;
      for (let i = 0; i < taskIds.length; i += batchSize) {
        const batch = taskIds.slice(i, i + batchSize);

        await client.crm.objects.tasks.batchApi.archive({
          inputs: batch.map((id) => ({ id })),
        });
        deletedCount += batch.length;
        console.log(
          `Deleted ${batch.length} tasks (total so far: ${deletedCount})`,
        );
      }

      // If we got fewer than 100, we're done
      if (taskIds.length < 100) {
        hasMore = false;
      }
    }

    console.log(`Total tasks deleted: ${deletedCount}`);

    return NextResponse.json({
      success: true,
      deletedCount,
      message: `Successfully deleted ${deletedCount} tasks from HubSpot`,
    });
  } catch (error: any) {
    console.error("Failed to delete tasks:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete tasks" },
      { status: 500 },
    );
  }
}
