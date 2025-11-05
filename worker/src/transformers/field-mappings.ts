import { FieldMapping, ObjectMapping } from "../types";

/**
 * Field mappings from Salesforce to HubSpot
 *
 * CUSTOMIZE THESE BASED ON YOUR REQUIREMENTS
 */

// Example: Contact field mappings (CUSTOMIZE THIS)
export const contactFieldMappings: FieldMapping[] = [
  { salesforceField: "Email", hubspotField: "email", required: true },
  { salesforceField: "FirstName", hubspotField: "firstname" },
  { salesforceField: "LastName", hubspotField: "lastname", required: true },
  // Add your custom fields here
];

// Example: Company field mappings (CUSTOMIZE THIS)
export const companyFieldMappings: FieldMapping[] = [
  { salesforceField: "Name", hubspotField: "name", required: true },
  // Add your custom fields here
];

// Example: Deal field mappings (CUSTOMIZE THIS)
export const dealFieldMappings: FieldMapping[] = [
  { salesforceField: "Name", hubspotField: "dealname", required: true },
  // Add your custom fields here
];

// Object mappings - ADD YOUR CUSTOM OBJECTS HERE
export const objectMappings: Record<string, ObjectMapping> = {
  // Example:
  // contacts: {
  //   salesforceObject: 'Contact',
  //   hubspotObject: 'contacts',
  //   fields: contactFieldMappings,
  // },
};

export default objectMappings;
