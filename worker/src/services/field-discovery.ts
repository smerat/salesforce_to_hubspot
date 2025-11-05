import * as jsforce from "jsforce";
import { Client } from "@hubspot/api-client";
import config from "../config";
import logger from "../utils/logger";

export interface SalesforceField {
  name: string;
  label: string;
  type: string;
  length?: number;
  picklistValues?: Array<{ label: string; value: string }>;
  referenceTo?: string[];
  relationshipName?: string;
  custom: boolean;
}

export interface HubSpotProperty {
  name: string;
  label: string;
  type: string;
  fieldType: string;
  groupName?: string;
  description?: string;
  options?: Array<{ label: string; value: string }>;
}

class FieldDiscoveryService {
  /**
   * Get all fields from a Salesforce object
   */
  async getSalesforceFields(
    objectName: string,
    connection: jsforce.Connection,
  ): Promise<SalesforceField[]> {
    try {
      logger.info(`Discovering Salesforce ${objectName} fields...`);

      const describe = await connection.sobject(objectName).describe();

      const fields: SalesforceField[] = describe.fields.map((field: any) => ({
        name: field.name,
        label: field.label,
        type: field.type,
        length: field.length,
        picklistValues: field.picklistValues,
        referenceTo: field.referenceTo,
        relationshipName: field.relationshipName,
        custom: field.custom,
      }));

      logger.info(`Found ${fields.length} fields for ${objectName}`);
      return fields;
    } catch (error: any) {
      logger.error(`Failed to discover Salesforce ${objectName} fields`, {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get all properties from a HubSpot object
   */
  async getHubSpotProperties(objectType: string): Promise<HubSpotProperty[]> {
    try {
      logger.info(`Discovering HubSpot ${objectType} properties...`);

      const client = new Client({
        accessToken: config.hubspot.accessToken,
      });

      const response = await client.crm.properties.coreApi.getAll(
        objectType as any,
      );

      const properties: HubSpotProperty[] = response.results.map(
        (prop: any) => ({
          name: prop.name,
          label: prop.label,
          type: prop.type,
          fieldType: prop.fieldType,
          groupName: prop.groupName,
          description: prop.description,
          options: prop.options,
        }),
      );

      logger.info(`Found ${properties.length} properties for ${objectType}`);
      return properties;
    } catch (error: any) {
      logger.error(`Failed to discover HubSpot ${objectType} properties`, {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get suggested mappings based on field names
   */
  suggestMappings(
    salesforceFields: SalesforceField[],
    hubspotProperties: HubSpotProperty[],
  ): Record<string, string> {
    const suggestions: Record<string, string> = {};

    // Common mappings
    const commonMappings: Record<string, string> = {
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

    for (const sfField of salesforceFields) {
      // Check common mappings first
      if (commonMappings[sfField.name]) {
        const hsName = commonMappings[sfField.name];
        const hsProperty = hubspotProperties.find((p) => p.name === hsName);
        if (hsProperty) {
          suggestions[sfField.name] = hsProperty.name;
          continue;
        }
      }

      // Try exact name match (lowercase)
      const exactMatch = hubspotProperties.find(
        (p) => p.name.toLowerCase() === sfField.name.toLowerCase(),
      );
      if (exactMatch) {
        suggestions[sfField.name] = exactMatch.name;
        continue;
      }

      // Try label match
      const labelMatch = hubspotProperties.find(
        (p) => p.label.toLowerCase() === sfField.label.toLowerCase(),
      );
      if (labelMatch) {
        suggestions[sfField.name] = labelMatch.name;
      }
    }

    return suggestions;
  }
}

export default new FieldDiscoveryService();
