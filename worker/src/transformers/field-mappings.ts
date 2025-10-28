import { FieldMapping, ObjectMapping } from '../types';

/**
 * Field mappings from Salesforce to HubSpot
 *
 * You can customize these mappings based on your specific needs
 */

// Contact field mappings
export const contactFieldMappings: FieldMapping[] = [
  { salesforceField: 'Email', hubspotField: 'email', required: true },
  { salesforceField: 'FirstName', hubspotField: 'firstname' },
  { salesforceField: 'LastName', hubspotField: 'lastname', required: true },
  { salesforceField: 'Phone', hubspotField: 'phone' },
  { salesforceField: 'MobilePhone', hubspotField: 'mobilephone' },
  { salesforceField: 'Title', hubspotField: 'jobtitle' },
  { salesforceField: 'Department', hubspotField: 'department' },
  {
    salesforceField: 'MailingStreet',
    hubspotField: 'address',
  },
  { salesforceField: 'MailingCity', hubspotField: 'city' },
  { salesforceField: 'MailingState', hubspotField: 'state' },
  { salesforceField: 'MailingPostalCode', hubspotField: 'zip' },
  { salesforceField: 'MailingCountry', hubspotField: 'country' },
  {
    salesforceField: 'CreatedDate',
    hubspotField: 'createdate',
    transform: (value: string) => {
      // Convert Salesforce datetime to HubSpot timestamp (milliseconds)
      return new Date(value).getTime().toString();
    },
  },
];

// Company (Account) field mappings
export const companyFieldMappings: FieldMapping[] = [
  { salesforceField: 'Name', hubspotField: 'name', required: true },
  { salesforceField: 'Website', hubspotField: 'domain' },
  { salesforceField: 'Phone', hubspotField: 'phone' },
  { salesforceField: 'Industry', hubspotField: 'industry' },
  {
    salesforceField: 'NumberOfEmployees',
    hubspotField: 'numberofemployees',
    transform: (value: number) => value?.toString(),
  },
  {
    salesforceField: 'AnnualRevenue',
    hubspotField: 'annualrevenue',
    transform: (value: number) => value?.toString(),
  },
  { salesforceField: 'Type', hubspotField: 'type' },
  { salesforceField: 'BillingStreet', hubspotField: 'address' },
  { salesforceField: 'BillingCity', hubspotField: 'city' },
  { salesforceField: 'BillingState', hubspotField: 'state' },
  { salesforceField: 'BillingPostalCode', hubspotField: 'zip' },
  { salesforceField: 'BillingCountry', hubspotField: 'country' },
  { salesforceField: 'Description', hubspotField: 'description' },
  {
    salesforceField: 'CreatedDate',
    hubspotField: 'createdate',
    transform: (value: string) => new Date(value).getTime().toString(),
  },
];

// Deal (Opportunity) field mappings
export const dealFieldMappings: FieldMapping[] = [
  { salesforceField: 'Name', hubspotField: 'dealname', required: true },
  {
    salesforceField: 'Amount',
    hubspotField: 'amount',
    transform: (value: number) => value?.toString() || '0',
  },
  {
    salesforceField: 'CloseDate',
    hubspotField: 'closedate',
    transform: (value: string) => {
      // HubSpot expects closedate as midnight UTC timestamp
      const date = new Date(value);
      date.setUTCHours(0, 0, 0, 0);
      return date.getTime().toString();
    },
  },
  {
    salesforceField: 'StageName',
    hubspotField: 'dealstage',
    // You may need to map Salesforce stages to HubSpot stages
    transform: (value: string) => mapDealStage(value),
  },
  {
    salesforceField: 'Probability',
    hubspotField: 'hs_deal_probability',
    transform: (value: number) => value?.toString(),
  },
  { salesforceField: 'Type', hubspotField: 'dealtype' },
  { salesforceField: 'LeadSource', hubspotField: 'hs_deal_source' },
  { salesforceField: 'Description', hubspotField: 'description' },
  {
    salesforceField: 'CreatedDate',
    hubspotField: 'createdate',
    transform: (value: string) => new Date(value).getTime().toString(),
  },
];

/**
 * Map Salesforce deal stages to HubSpot deal stages
 * You'll need to customize this based on your specific pipeline configuration
 */
function mapDealStage(salesforceStage: string): string {
  const stageMapping: Record<string, string> = {
    'Prospecting': 'appointmentscheduled',
    'Qualification': 'qualifiedtobuy',
    'Needs Analysis': 'presentationscheduled',
    'Value Proposition': 'decisionmakerboughtin',
    'Id. Decision Makers': 'contractsent',
    'Perception Analysis': 'contractsent',
    'Proposal/Price Quote': 'contractsent',
    'Negotiation/Review': 'contractsent',
    'Closed Won': 'closedwon',
    'Closed Lost': 'closedlost',
  };

  return stageMapping[salesforceStage] || 'appointmentscheduled';
}

// Object mappings
export const objectMappings: Record<'contacts' | 'companies' | 'deals', ObjectMapping> = {
  contacts: {
    salesforceObject: 'Contact',
    hubspotObject: 'contacts',
    fields: contactFieldMappings,
  },
  companies: {
    salesforceObject: 'Account',
    hubspotObject: 'companies',
    fields: companyFieldMappings,
  },
  deals: {
    salesforceObject: 'Opportunity',
    hubspotObject: 'deals',
    fields: dealFieldMappings,
  },
};

export default objectMappings;
