import { NextResponse } from "next/server";
import jsforce from "jsforce";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const objectName = searchParams.get("object") || "Account";

  try {
    // Get Salesforce credentials from environment
    const SF_LOGIN_URL = process.env.SF_LOGIN_URL!;
    const SF_USERNAME = process.env.SF_USERNAME!;
    const SF_PASSWORD = process.env.SF_PASSWORD!;
    const SF_SECURITY_TOKEN = process.env.SF_SECURITY_TOKEN!;

    // Connect to Salesforce
    const conn = new jsforce.Connection({
      loginUrl: SF_LOGIN_URL,
    });

    await conn.login(SF_USERNAME, SF_PASSWORD + SF_SECURITY_TOKEN);

    // Describe the object
    const describe = await conn.sobject(objectName).describe();

    // Map fields to a simpler format
    const fields = describe.fields.map((field: any) => ({
      name: field.name,
      label: field.label,
      type: field.type,
      length: field.length,
      custom: field.custom,
      updateable: field.updateable,
      createable: field.createable,
      referenceTo: field.referenceTo, // For OwnerId and other lookups
    }));

    // Sort: standard fields first, then custom
    fields.sort((a, b) => {
      if (a.custom === b.custom) {
        return a.label.localeCompare(b.label);
      }
      return a.custom ? 1 : -1;
    });

    return NextResponse.json({ fields });
  } catch (error: any) {
    console.error("Failed to fetch Salesforce fields:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch Salesforce fields" },
      { status: 500 },
    );
  }
}
