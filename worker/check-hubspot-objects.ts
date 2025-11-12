import hubspotLoader from "./src/loaders/hubspot";

async function checkObjects() {
  console.log("Checking if objects exist in HubSpot...\n");

  // Check company
  const companyId = "117813683157";
  try {
    const company = await (hubspotLoader as any).client.crm.companies.basicApi.getById(
      companyId,
    );
    console.log(`✓ Company ${companyId} EXISTS`);
    console.log(`  Name: ${company.properties.name || "N/A"}\n`);
  } catch (error: any) {
    console.log(`✗ Company ${companyId} NOT FOUND`);
    console.log(`  Error: ${error.message}\n`);
  }

  // Check meeting
  const meetingId = "165768635372";
  try {
    const meeting = await (hubspotLoader as any).client.crm.objects.meetings.basicApi.getById(
      meetingId,
    );
    console.log(`✓ Meeting ${meetingId} EXISTS`);
    console.log(`  Title: ${meeting.properties.hs_meeting_title || "N/A"}\n`);
  } catch (error: any) {
    console.log(`✗ Meeting ${meetingId} NOT FOUND`);
    console.log(`  Error: ${error.message}\n`);
  }

  process.exit(0);
}

checkObjects().catch(console.error);
