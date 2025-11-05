import { NextResponse } from 'next/server';
import { Client } from '@hubspot/api-client';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const objectType = searchParams.get('object') || 'companies';

  try {
    const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!;

    const client = new Client({
      accessToken: HUBSPOT_ACCESS_TOKEN,
    });

    const response = await client.crm.properties.coreApi.getAll(objectType as any);

    const properties = response.results.map((prop: any) => ({
      name: prop.name,
      label: prop.label,
      type: prop.type,
      fieldType: prop.fieldType,
      groupName: prop.groupName,
      description: prop.description,
      hidden: prop.hidden,
      readOnlyValue: prop.readOnlyValue,
    }));

    // Sort by label
    properties.sort((a, b) => a.label.localeCompare(b.label));

    return NextResponse.json({ properties });
  } catch (error: any) {
    console.error('Failed to fetch HubSpot properties:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch HubSpot properties' },
      { status: 500 }
    );
  }
}
