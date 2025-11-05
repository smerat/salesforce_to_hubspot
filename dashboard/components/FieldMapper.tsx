"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ReloadIcon, CheckIcon } from "@radix-ui/react-icons";

interface SalesforceField {
  name: string;
  label: string;
  type: string;
  custom: boolean;
  updateable: boolean;
}

interface HubSpotProperty {
  name: string;
  label: string;
  type: string;
  fieldType: string;
  readOnlyValue: boolean;
}

export interface FieldMapping {
  salesforceField: string;
  hubspotField: string;
  enabled: boolean;
}

interface FieldMapperProps {
  onNext: (mappings: FieldMapping[]) => void;
}

export default function FieldMapper({ onNext }: FieldMapperProps) {
  const [sfFields, setSfFields] = useState<SalesforceField[]>([]);
  const [hsProperties, setHsProperties] = useState<HubSpotProperty[]>([]);
  const [mappings, setMappings] = useState<
    Record<string, { hubspotField: string; enabled: boolean }>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchFields();
  }, []);

  async function fetchFields() {
    setLoading(true);
    setError(null);

    try {
      // Fetch Salesforce Account fields
      const sfResponse = await fetch("/api/fields/salesforce?object=Account");
      if (!sfResponse.ok) throw new Error("Failed to fetch Salesforce fields");
      const sfData = await sfResponse.json();

      // Fetch HubSpot Company properties
      const hsResponse = await fetch("/api/fields/hubspot?object=companies");
      if (!hsResponse.ok) throw new Error("Failed to fetch HubSpot properties");
      const hsData = await hsResponse.json();

      setSfFields(sfData.fields);
      setHsProperties(hsData.properties);

      // Initialize mappings with smart suggestions
      const initialMappings: Record<
        string,
        { hubspotField: string; enabled: boolean }
      > = {};

      // Common mappings
      const commonMaps: Record<string, string> = {
        Name: "name",
        Website: "domain",
        Phone: "phone",
        Industry: "industry",
        NumberOfEmployees: "numberofemployees",
        AnnualRevenue: "annualrevenue",
        BillingStreet: "address",
        BillingCity: "city",
        BillingState: "state",
        BillingPostalCode: "zip",
        BillingCountry: "country",
        Description: "description",
        Type: "type",
        OwnerId: "hubspot_owner_id",
        Id: "salesforce_account_id",
      };

      for (const field of sfData.fields) {
        if (field.updateable) {
          const hsField = commonMaps[field.name] || "";
          initialMappings[field.name] = {
            hubspotField: hsField,
            enabled: !!hsField, // Enable if we found a mapping
          };
        }
      }

      setMappings(initialMappings);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function toggleField(sfFieldName: string) {
    setMappings((prev) => ({
      ...prev,
      [sfFieldName]: {
        ...prev[sfFieldName],
        enabled: !prev[sfFieldName]?.enabled,
      },
    }));
  }

  function updateHubSpotField(sfFieldName: string, hsFieldName: string) {
    setMappings((prev) => ({
      ...prev,
      [sfFieldName]: {
        hubspotField: hsFieldName,
        enabled: prev[sfFieldName]?.enabled || false,
      },
    }));
  }

  function selectAll() {
    const updated = { ...mappings };
    Object.keys(updated).forEach((key) => {
      if (updated[key].hubspotField) {
        updated[key].enabled = true;
      }
    });
    setMappings(updated);
  }

  function deselectAll() {
    const updated = { ...mappings };
    Object.keys(updated).forEach((key) => {
      updated[key].enabled = false;
    });
    setMappings(updated);
  }

  function handleNext() {
    const fieldMappings: FieldMapping[] = Object.entries(mappings)
      .filter(([_, value]) => value.enabled && value.hubspotField)
      .map(([sfField, value]) => ({
        salesforceField: sfField,
        hubspotField: value.hubspotField,
        enabled: value.enabled,
      }));

    onNext(fieldMappings);
  }

  const enabledCount = Object.values(mappings).filter((m) => m.enabled).length;

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <ReloadIcon className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-3 text-muted-foreground">
            Loading field definitions...
          </span>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-red-400">Error: {error}</p>
          <Button onClick={fetchFields} className="mt-4" variant="outline">
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Field Mapping Configuration</CardTitle>
            <CardDescription>
              Map Salesforce Account fields to HubSpot Company properties
            </CardDescription>
          </div>
          <Badge variant="default">{enabledCount} fields selected</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Controls */}
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={selectAll}>
            <CheckIcon className="mr-2 h-4 w-4" />
            Select All
          </Button>
          <Button size="sm" variant="outline" onClick={deselectAll}>
            Deselect All
          </Button>
        </div>

        {/* Field Mappings */}
        <div className="max-h-[500px] space-y-2 overflow-y-auto rounded-md border p-4">
          {sfFields
            .filter((field) => field.updateable)
            .map((field) => (
              <div
                key={field.name}
                className="flex items-center gap-3 rounded-md border p-3 hover:bg-accent/50"
              >
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={mappings[field.name]?.enabled || false}
                  onChange={() => toggleField(field.name)}
                  className="h-4 w-4 rounded border-input"
                />

                {/* Salesforce Field */}
                <div className="flex-1">
                  <div className="font-medium">{field.label}</div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{field.name}</span>
                    <span>•</span>
                    <span>{field.type}</span>
                    {field.custom && (
                      <Badge variant="secondary" className="text-xs">
                        Custom
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Arrow */}
                <div className="text-muted-foreground">→</div>

                {/* HubSpot Dropdown */}
                <div className="flex-1">
                  <select
                    value={mappings[field.name]?.hubspotField || ""}
                    onChange={(e) =>
                      updateHubSpotField(field.name, e.target.value)
                    }
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    disabled={!mappings[field.name]?.enabled}
                  >
                    <option value="">Select HubSpot field...</option>
                    {hsProperties
                      .filter((prop) => !prop.readOnlyValue)
                      .map((prop) => (
                        <option key={prop.name} value={prop.name}>
                          {prop.label} ({prop.name})
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            ))}
        </div>

        {/* Next Button */}
        <div className="flex justify-end">
          <Button onClick={handleNext} disabled={enabledCount === 0} size="lg">
            Next: Preview Migration
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
