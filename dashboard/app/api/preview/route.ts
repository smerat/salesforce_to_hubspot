import { NextResponse } from "next/server";
import jsforce from "jsforce";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { objectName, fields, limit = 3, whereClause } = body;

    if (!objectName || !fields || fields.length === 0) {
      return NextResponse.json(
        { error: "objectName and fields are required" },
        { status: 400 },
      );
    }

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

    // Get total count
    const countQuery = whereClause
      ? `SELECT COUNT() FROM ${objectName} WHERE ${whereClause}`
      : `SELECT COUNT() FROM ${objectName}`;
    const countResult = await conn.query(countQuery);
    const totalCount = countResult.totalSize;

    // Get sample records - ensure Id is included and not duplicated
    const uniqueFields = Array.from(new Set(["Id", ...fields]));
    const fieldList = uniqueFields.join(", ");

    let query = `SELECT ${fieldList} FROM ${objectName}`;
    if (whereClause) {
      query += ` WHERE ${whereClause}`;
    }
    query += ` ORDER BY Id ASC LIMIT ${limit}`;

    const result = await conn.query(query);

    return NextResponse.json({
      totalCount,
      sampleRecords: result.records,
    });
  } catch (error: any) {
    console.error("Failed to fetch preview data:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch preview data" },
      { status: 500 },
    );
  }
}
