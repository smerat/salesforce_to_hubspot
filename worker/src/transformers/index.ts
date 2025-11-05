import logger from "../utils/logger";
import {
  SalesforceContact,
  SalesforceAccount,
  SalesforceOpportunity,
  SalesforceRecord,
  HubSpotContact,
  HubSpotCompany,
  HubSpotDeal,
  ObjectType,
  TransformResult,
} from "../types";
import { objectMappings } from "./field-mappings";

class DataTransformer {
  /**
   * Transform a Salesforce contact to HubSpot contact format
   */
  transformContact(sfContact: SalesforceContact): TransformResult {
    try {
      const properties: Record<string, any> = {};

      for (const mapping of objectMappings.contacts.fields) {
        const value =
          sfContact[mapping.salesforceField as keyof SalesforceContact];

        // Skip if value is null/undefined and field is not required
        if (value == null && !mapping.required) {
          continue;
        }

        // Check required fields
        if (mapping.required && value == null) {
          return {
            success: false,
            error: `Required field ${mapping.salesforceField} is missing`,
          };
        }

        // Apply transformation if provided
        const transformedValue = mapping.transform
          ? mapping.transform(value)
          : value;
        properties[mapping.hubspotField] = transformedValue;
      }

      // Add custom Salesforce ID for tracking
      properties["salesforce_id"] = sfContact.Id;

      const hubspotContact: HubSpotContact = { properties };

      logger.debug("Transformed contact", {
        salesforceId: sfContact.Id,
        email: properties.email,
      });

      return {
        success: true,
        data: hubspotContact,
      };
    } catch (error: any) {
      logger.error("Failed to transform contact", {
        salesforceId: sfContact.Id,
        error: error.message,
      });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Transform a Salesforce account to HubSpot company format
   */
  transformCompany(sfAccount: SalesforceAccount): TransformResult {
    try {
      const properties: Record<string, any> = {};

      for (const mapping of objectMappings.companies.fields) {
        const value =
          sfAccount[mapping.salesforceField as keyof SalesforceAccount];

        if (value == null && !mapping.required) {
          continue;
        }

        if (mapping.required && value == null) {
          return {
            success: false,
            error: `Required field ${mapping.salesforceField} is missing`,
          };
        }

        const transformedValue = mapping.transform
          ? mapping.transform(value)
          : value;
        properties[mapping.hubspotField] = transformedValue;
      }

      // Add custom Salesforce ID
      properties["salesforce_id"] = sfAccount.Id;

      const hubspotCompany: HubSpotCompany = { properties } as any;

      logger.debug("Transformed company", {
        salesforceId: sfAccount.Id,
        name: properties.name,
      });

      return {
        success: true,
        data: hubspotCompany,
      };
    } catch (error: any) {
      logger.error("Failed to transform company", {
        salesforceId: sfAccount.Id,
        error: error.message,
      });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Transform a Salesforce opportunity to HubSpot deal format
   */
  transformDeal(
    sfOpportunity: SalesforceOpportunity,
    accountHubSpotId?: string,
  ): TransformResult {
    try {
      const properties: Record<string, any> = {};

      for (const mapping of objectMappings.deals.fields) {
        const value =
          sfOpportunity[mapping.salesforceField as keyof SalesforceOpportunity];

        if (value == null && !mapping.required) {
          continue;
        }

        if (mapping.required && value == null) {
          return {
            success: false,
            error: `Required field ${mapping.salesforceField} is missing`,
          };
        }

        const transformedValue = mapping.transform
          ? mapping.transform(value)
          : value;
        properties[mapping.hubspotField] = transformedValue;
      }

      // Add custom Salesforce ID
      properties["salesforce_id"] = sfOpportunity.Id;

      const hubspotDeal: HubSpotDeal = { properties } as any;

      // Add association to company if AccountId exists and we have the HubSpot ID
      if (accountHubSpotId) {
        hubspotDeal.associations = [
          {
            to: { id: accountHubSpotId },
            types: [
              {
                associationCategory: "HUBSPOT_DEFINED",
                associationTypeId: 341, // Deal to Company association type
              },
            ],
          },
        ];
      }

      logger.debug("Transformed deal", {
        salesforceId: sfOpportunity.Id,
        dealname: properties.dealname,
        hasCompanyAssociation: !!accountHubSpotId,
      });

      return {
        success: true,
        data: hubspotDeal,
      };
    } catch (error: any) {
      logger.error("Failed to transform deal", {
        salesforceId: sfOpportunity.Id,
        error: error.message,
      });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Generic transform method
   */
  transform(
    objectType: ObjectType,
    record: SalesforceRecord,
    additionalData?: any,
  ): TransformResult {
    switch (objectType) {
      case "contacts":
        return this.transformContact(record as SalesforceContact);
      case "companies":
        return this.transformCompany(record as SalesforceAccount);
      case "deals":
        return this.transformDeal(
          record as SalesforceOpportunity,
          additionalData?.accountHubSpotId,
        );
      default:
        return {
          success: false,
          error: `Unsupported object type: ${objectType}`,
        };
    }
  }

  /**
   * Validate that a record has all required fields
   */
  validateRecord(
    objectType: ObjectType,
    record: SalesforceRecord,
  ): TransformResult {
    const mapping = objectMappings[objectType as keyof typeof objectMappings];

    if (!mapping) {
      return {
        success: false,
        error: `No mapping found for object type: ${objectType}`,
      };
    }

    const requiredFields = mapping.fields.filter((f) => f.required);

    for (const field of requiredFields) {
      const value = record[field.salesforceField as keyof SalesforceRecord];
      if (value == null) {
        return {
          success: false,
          error: `Missing required field: ${field.salesforceField}`,
        };
      }
    }

    return { success: true };
  }
}

export default new DataTransformer();
