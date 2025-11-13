import * as XLSX from "xlsx";
import logger from "./logger";

export interface CallRecord {
  activityId: string;
  associationTypeId: number;
  salesforceId: string; // Contact/Account/Opportunity ID
  objectType: "contact" | "company" | "deal";
  owner: string;
  title: string;
  timestamp: string;
  status: string;
  body: string;
}

export interface EmailRecord {
  activityId: string;
  associationTypeId: number;
  salesforceId: string; // Contact/Account/Opportunity ID
  objectType: "contact" | "company" | "deal";
  owner: string;
  subject: string;
  timestamp: string;
  status: string;
  direction: string;
  body: string;
}

export interface MeetingRecord {
  activityId: string;
  associationTypeId: number;
  salesforceId: string; // Contact/Account/Opportunity ID
  objectType: "contact" | "company" | "deal";
  owner: string;
  title: string;
  timestamp: string;
  endTime?: string;
  outcome: string;
  activityType: string;
  body: string;
}

export interface TaskRecord {
  activityId: string;
  associationTypeId: number;
  salesforceId: string; // Contact/Account/Opportunity ID
  objectType: "contact" | "company" | "deal";
  owner: string;
  subject: string;
  timestamp: string;
  status: string;
}

/**
 * Read and parse Excel files containing call data
 */
export class ExcelReader {
  /**
   * Parse timestamp from Excel format to ISO string
   * Example: "2025-05-02, 6:24 a.m." -> ISO timestamp
   */
  private parseTimestamp(timestampStr: string): number {
    try {
      // Handle format: "2025-05-02, 6:24 a.m."
      const cleanedStr = timestampStr.replace(",", "").trim();

      // Parse date and time parts
      const match = cleanedStr.match(
        /(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s*(a\.m\.|p\.m\.)/i,
      );

      if (!match) {
        logger.warn("Unable to parse timestamp, using current time", {
          timestamp: timestampStr,
        });
        return Date.now();
      }

      const [, year, month, day, hour, minute, period] = match;
      let hours = parseInt(hour);

      // Convert to 24-hour format
      if (period.toLowerCase() === "p.m." && hours !== 12) {
        hours += 12;
      } else if (period.toLowerCase() === "a.m." && hours === 12) {
        hours = 0;
      }

      const date = new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        hours,
        parseInt(minute),
      );

      return date.getTime();
    } catch (error: any) {
      logger.error("Error parsing timestamp", {
        timestamp: timestampStr,
        error: error.message,
      });
      return Date.now();
    }
  }

  /**
   * Parse date-only timestamp (add 12:00 AM)
   * Example: "2025-06-23" -> timestamp at midnight
   */
  private parseDateOnlyTimestamp(dateStr: string): number {
    try {
      const cleanedStr = dateStr.trim();

      // Match date-only format: YYYY-MM-DD
      const match = cleanedStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);

      if (!match) {
        logger.warn("Unable to parse date, using current time", {
          date: dateStr,
        });
        return Date.now();
      }

      const [, year, month, day] = match;

      // Create date at midnight (12:00 AM)
      const date = new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        0, // hours: 12 AM
        0, // minutes
        0, // seconds
      );

      return date.getTime();
    } catch (error: any) {
      logger.error("Error parsing date", {
        date: dateStr,
        error: error.message,
      });
      return Date.now();
    }
  }

  /**
   * Determine object type based on association type ID
   */
  private getObjectType(
    associationTypeId: number,
  ): "contact" | "company" | "deal" {
    switch (associationTypeId) {
      // Call association type IDs
      case 194:
        return "contact";
      case 182:
        return "company";
      case 206:
        return "deal";
      // Email association type IDs
      case 198:
        return "contact";
      case 186:
        return "company";
      case 210:
        return "deal";
      // Meeting association type IDs
      case 200:
        return "contact";
      case 188:
        return "company";
      case 212:
        return "deal";
      // Task association type IDs
      case 204:
        return "contact";
      case 192:
        return "company";
      case 216:
        return "deal";
      default:
        logger.warn("Unknown association type ID, defaulting to contact", {
          associationTypeId,
        });
        return "contact";
    }
  }

  /**
   * Read call records from Contacts Excel file
   */
  readContactsFile(filePath: string): CallRecord[] {
    logger.info("Reading Contacts Excel file", { filePath });

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    const records: CallRecord[] = data.map((row: any) => ({
      activityId: row["salesforce Activity ID"]?.toString().trim() || "",
      associationTypeId: parseInt(row["AssociationTypeId"]) || 194,
      salesforceId: row["Salesforce Contact ID"]?.toString().trim() || "",
      objectType: this.getObjectType(parseInt(row["AssociationTypeId"]) || 194),
      owner: row["owner"]?.toString().trim() || "",
      title: row["hs_call_title"]?.toString().trim() || "Call",
      timestamp: row["hs_timestamp"]?.toString().trim() || "",
      status: row["hs_call_status"]?.toString().trim() || "COMPLETED",
      body:
        row["hs_call_body"]?.toString().trim() ||
        row["Full Comments"]?.toString().trim() ||
        row["Description"]?.toString().trim() ||
        "",
    }));

    logger.info(`Read ${records.length} contact call records`);
    return records.filter((r) => r.activityId && r.salesforceId);
  }

  /**
   * Read call records from Accounts Excel file
   */
  readAccountsFile(filePath: string): CallRecord[] {
    logger.info("Reading Accounts Excel file", { filePath });

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    const records: CallRecord[] = data.map((row: any) => ({
      activityId:
        row["Salesforec Activity ID"]?.toString().trim() ||
        row["Salesforce Activity ID"]?.toString().trim() ||
        "",
      associationTypeId: parseInt(row["AssociationTypeId"]) || 182,
      salesforceId: row["Salesforce Account ID"]?.toString().trim() || "",
      objectType: this.getObjectType(parseInt(row["AssociationTypeId"]) || 182),
      owner: row["owner"]?.toString().trim() || "",
      title: row["hs_call_title"]?.toString().trim() || "Call",
      timestamp: row["hs_timestamp"]?.toString().trim() || "",
      status: row["hs_call_status"]?.toString().trim() || "COMPLETED",
      body: row["hs_call_body"]?.toString().trim() || "",
    }));

    logger.info(`Read ${records.length} account call records`);
    return records.filter((r) => r.activityId && r.salesforceId);
  }

  /**
   * Read call records from Opportunities Excel file
   */
  readOpportunitiesFile(filePath: string): CallRecord[] {
    logger.info("Reading Opportunities Excel file", { filePath });

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    const records: CallRecord[] = data.map((row: any) => ({
      activityId: row["salesforce Activity ID"]?.toString().trim() || "",
      associationTypeId: parseInt(row["AssociationTypeId"]) || 206,
      salesforceId: row["Salesforce Opportunity ID"]?.toString().trim() || "",
      objectType: this.getObjectType(parseInt(row["AssociationTypeId"]) || 206),
      owner: row["owner"]?.toString().trim() || "",
      title: row["hs_call_title"]?.toString().trim() || "Call",
      timestamp: row["hs_timestamp"]?.toString().trim() || "",
      status: row["hs_call_status"]?.toString().trim() || "COMPLETED",
      body:
        row["Comments"]?.toString().trim() ||
        row["hs_call_body"]?.toString().trim() ||
        "",
    }));

    logger.info(`Read ${records.length} opportunity call records`);
    return records.filter((r) => r.activityId && r.salesforceId);
  }

  /**
   * Read all Excel files and combine records
   */
  readAllFiles(
    contactsPath: string,
    accountsPath: string,
    opportunitiesPath: string,
  ): CallRecord[] {
    const contactRecords = this.readContactsFile(contactsPath);
    const accountRecords = this.readAccountsFile(accountsPath);
    const opportunityRecords = this.readOpportunitiesFile(opportunitiesPath);

    const allRecords = [
      ...contactRecords,
      ...accountRecords,
      ...opportunityRecords,
    ];

    logger.info("Total call records read from all files", {
      total: allRecords.length,
      contacts: contactRecords.length,
      accounts: accountRecords.length,
      opportunities: opportunityRecords.length,
    });

    return allRecords;
  }

  /**
   * Group records by Activity ID
   * Returns Map of activityId -> array of records
   */
  groupByActivityId(records: CallRecord[]): Map<string, CallRecord[]> {
    const grouped = new Map<string, CallRecord[]>();

    for (const record of records) {
      if (!grouped.has(record.activityId)) {
        grouped.set(record.activityId, []);
      }
      grouped.get(record.activityId)!.push(record);
    }

    logger.info("Grouped records by Activity ID", {
      uniqueActivities: grouped.size,
      totalRecords: records.length,
    });

    return grouped;
  }

  /**
   * Parse timestamp for HubSpot
   */
  parseTimestampForHubSpot(timestampStr: string): number {
    return this.parseTimestamp(timestampStr);
  }

  /**
   * Parse meeting timestamp for HubSpot (date-only format with 12:00 AM)
   */
  parseMeetingTimestampForHubSpot(timestampStr: string): number {
    return this.parseDateOnlyTimestamp(timestampStr);
  }

  // ============= EMAIL METHODS =============

  /**
   * Read email records from Contacts Excel file
   */
  readEmailContactsFile(filePath: string): EmailRecord[] {
    logger.info("Reading Contacts Email file", { filePath });

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    const records: EmailRecord[] = data.map((row: any) => ({
      activityId: row["Salesforce Activity ID"]?.toString().trim() || "",
      associationTypeId: parseInt(row["AssociationTypeId"]) || 198,
      salesforceId: row["Salesforce Contact ID"]?.toString().trim() || "",
      objectType: this.getObjectType(parseInt(row["AssociationTypeId"]) || 198),
      owner: row["hubspot_owner"]?.toString().trim() || "",
      subject: row["hs_email_subject"]?.toString().trim() || "",
      timestamp: row["hs_timestamp"]?.toString().trim() || "",
      status: row["hs_email_status"]?.toString().trim() || "SENT",
      direction: row["hs_email_direction"]?.toString().trim() || "EMAIL",
      body:
        row["hs_email_text"]?.toString().trim() ||
        row["Full Comments"]?.toString().trim() ||
        "",
    }));

    logger.info(`Read ${records.length} contact email records from file`);

    // Filter out invalid records and non-Contact IDs (e.g., Account IDs starting with 001)
    const validRecords = records.filter((r) => {
      if (!r.activityId || !r.salesforceId) return false;

      // Contact IDs start with 003, Account IDs start with 001
      // Only keep Contact IDs in the Contacts file
      if (!r.salesforceId.startsWith("003")) {
        logger.debug(
          `Skipping non-Contact ID in Contacts file: ${r.salesforceId} (Activity: ${r.activityId})`,
        );
        return false;
      }

      return true;
    });

    logger.info(
      `Filtered to ${validRecords.length} valid contact email records (removed ${records.length - validRecords.length} non-contact IDs)`,
    );
    return validRecords;
  }

  /**
   * Read email records from Accounts Excel file
   */
  readEmailAccountsFile(filePath: string): EmailRecord[] {
    logger.info("Reading Accounts Email file", { filePath });

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    const records: EmailRecord[] = data.map((row: any) => ({
      activityId: row["Salesforce Activity ID"]?.toString().trim() || "",
      associationTypeId: parseInt(row["AssociationTypeId"]) || 186,
      salesforceId: row["Salesforce Account ID"]?.toString().trim() || "",
      objectType: this.getObjectType(parseInt(row["AssociationTypeId"]) || 186),
      owner: row["hubspot_owner_id"]?.toString().trim() || "",
      subject: row["hs_email_subject"]?.toString().trim() || "",
      timestamp: row["hs_timestamp"]?.toString().trim() || "",
      status: row["hs_email_status"]?.toString().trim() || "SENT",
      direction: row["hs_email_direction"]?.toString().trim() || "EMAIL",
      body: row["hs_email_text"]?.toString().trim() || "",
    }));

    logger.info(`Read ${records.length} account email records`);
    return records.filter((r) => r.activityId && r.salesforceId);
  }

  /**
   * Read email records from Opportunities Excel file
   */
  readEmailOpportunitiesFile(filePath: string): EmailRecord[] {
    logger.info("Reading Opportunities Email file", { filePath });

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    const records: EmailRecord[] = data.map((row: any) => ({
      activityId: row["Salesforce Activity ID"]?.toString().trim() || "",
      associationTypeId: parseInt(row["AssociationTypeId"]) || 210,
      salesforceId: row["Salesforce Opportunity ID"]?.toString().trim() || "",
      objectType: this.getObjectType(parseInt(row["AssociationTypeId"]) || 210),
      owner: row["hubspot_owner_id"]?.toString().trim() || "",
      subject: row["hs_email_subject"]?.toString().trim() || "",
      timestamp: row["hs_timestamp"]?.toString().trim() || "",
      status: row["hs_email_status"]?.toString().trim() || "SENT",
      direction: row["__EMPTY"]?.toString().trim() || "EMAIL",
      body: row["hs_email_text"]?.toString().trim() || "",
    }));

    logger.info(`Read ${records.length} opportunity email records`);
    return records.filter((r) => r.activityId && r.salesforceId);
  }

  /**
   * Read all email Excel files and combine records
   */
  readAllEmailFiles(
    contactsPath: string,
    accountsPath: string,
    opportunitiesPath: string,
  ): EmailRecord[] {
    const contactRecords = this.readEmailContactsFile(contactsPath);
    const accountRecords = this.readEmailAccountsFile(accountsPath);
    const opportunityRecords =
      this.readEmailOpportunitiesFile(opportunitiesPath);

    const allRecords = [
      ...contactRecords,
      ...accountRecords,
      ...opportunityRecords,
    ];

    logger.info("Total email records read from all files", {
      total: allRecords.length,
      contacts: contactRecords.length,
      accounts: accountRecords.length,
      opportunities: opportunityRecords.length,
    });

    return allRecords;
  }

  /**
   * Group email records by Activity ID
   * Returns Map of activityId -> array of records
   */
  groupEmailsByActivityId(records: EmailRecord[]): Map<string, EmailRecord[]> {
    const grouped = new Map<string, EmailRecord[]>();

    for (const record of records) {
      if (!grouped.has(record.activityId)) {
        grouped.set(record.activityId, []);
      }
      grouped.get(record.activityId)!.push(record);
    }

    logger.info(
      `Grouped ${records.length} email records into ${grouped.size} unique emails`,
    );
    return grouped;
  }

  // ============= MEETING METHODS =============

  /**
   * Read meeting records from Contacts Excel file
   */
  readMeetingContactsFile(filePath: string): MeetingRecord[] {
    logger.info("Reading Contacts Meeting file", { filePath });

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    const records: MeetingRecord[] = data.map((row: any) => ({
      activityId: row["Salesforce Activity ID"]?.toString().trim() || "",
      associationTypeId: parseInt(row["AssociationTypeId"]) || 200,
      salesforceId: row["Salesforce Contact ID"]?.toString().trim() || "",
      objectType: this.getObjectType(parseInt(row["AssociationTypeId"]) || 200),
      owner: row["owner"]?.toString().trim() || "",
      title: row["hs_meeting_title"]?.toString().trim() || "Meeting",
      timestamp: row["hs_timestamp"]?.toString().trim() || "",
      endTime: row["hs_meeting_end_time"]?.toString().trim() || undefined,
      outcome: row["hs_meeting_outcome"]?.toString().trim() || "COMPLETED",
      activityType: row["hs_activity_type"]?.toString().trim() || "",
      body: row["hs_meeting_body"]?.toString().trim() || "",
    }));

    logger.info(`Read ${records.length} contact meeting records from file`);

    // Filter out invalid records and non-Contact IDs
    const validRecords = records.filter((r) => {
      if (!r.activityId || !r.salesforceId) return false;

      // Only keep Contact IDs (003 prefix)
      if (!r.salesforceId.startsWith("003")) {
        logger.debug(
          `Skipping non-Contact ID in Contacts file: ${r.salesforceId} (Activity: ${r.activityId})`,
        );
        return false;
      }

      return true;
    });

    logger.info(
      `Filtered to ${validRecords.length} valid contact meeting records (removed ${records.length - validRecords.length} non-contact IDs)`,
    );
    return validRecords;
  }

  /**
   * Read meeting records from Accounts Excel file
   */
  readMeetingAccountsFile(filePath: string): MeetingRecord[] {
    logger.info("Reading Accounts Meeting file", { filePath });

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    const records: MeetingRecord[] = data.map((row: any) => ({
      activityId: row["Salesforce Activity ID"]?.toString().trim() || "",
      associationTypeId: parseInt(row["AssociationTypeId"]) || 188,
      salesforceId: row["Salesforce Account ID"]?.toString().trim() || "",
      objectType: this.getObjectType(parseInt(row["AssociationTypeId"]) || 188),
      owner: row["owner"]?.toString().trim() || "",
      title: row["hs_meeting_title"]?.toString().trim() || "Meeting",
      timestamp: row["hs_timestamp"]?.toString().trim() || "",
      endTime: row["hs_meeting_end_time"]?.toString().trim() || undefined,
      outcome: row["hs_meeting_outcome"]?.toString().trim() || "COMPLETED",
      activityType: row["hs_activity_type"]?.toString().trim() || "",
      body: row["hs_meeting_body"]?.toString().trim() || "",
    }));

    logger.info(`Read ${records.length} account meeting records`);
    return records.filter((r) => r.activityId && r.salesforceId);
  }

  /**
   * Read meeting records from Opportunities Excel file
   */
  readMeetingOpportunitiesFile(filePath: string): MeetingRecord[] {
    logger.info("Reading Opportunities Meeting file", { filePath });

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    const records: MeetingRecord[] = data.map((row: any) => ({
      activityId: row["Salesforce Activity ID"]?.toString().trim() || "",
      associationTypeId: parseInt(row["AssociationTypeId"]) || 212,
      salesforceId: row["Salesforce Opportunity ID"]?.toString().trim() || "",
      objectType: this.getObjectType(parseInt(row["AssociationTypeId"]) || 212),
      owner: row["owner"]?.toString().trim() || "",
      title: row["hs_meeting_title"]?.toString().trim() || "Meeting",
      timestamp: row["hs_timestamp"]?.toString().trim() || "",
      endTime: row["hs_meeting_end_time"]?.toString().trim() || undefined,
      outcome: row["hs_meeting_outcome"]?.toString().trim() || "COMPLETED",
      activityType: row["hs_activity_type"]?.toString().trim() || "",
      body: row["hs_meeting_body"]?.toString().trim() || "",
    }));

    logger.info(`Read ${records.length} opportunity meeting records`);
    return records.filter((r) => r.activityId && r.salesforceId);
  }

  /**
   * Read all meeting Excel files and combine records
   */
  readAllMeetingFiles(
    contactsPath: string,
    accountsPath: string,
    opportunitiesPath: string,
  ): MeetingRecord[] {
    const contactRecords = this.readMeetingContactsFile(contactsPath);
    const accountRecords = this.readMeetingAccountsFile(accountsPath);
    const opportunityRecords =
      this.readMeetingOpportunitiesFile(opportunitiesPath);

    const allRecords = [
      ...contactRecords,
      ...accountRecords,
      ...opportunityRecords,
    ];

    logger.info("Total meeting records read from all files", {
      total: allRecords.length,
      contacts: contactRecords.length,
      accounts: accountRecords.length,
      opportunities: opportunityRecords.length,
    });

    return allRecords;
  }

  /**
   * Group meeting records by Activity ID
   */
  groupMeetingsByActivityId(
    records: MeetingRecord[],
  ): Map<string, MeetingRecord[]> {
    const grouped = new Map<string, MeetingRecord[]>();

    for (const record of records) {
      if (!grouped.has(record.activityId)) {
        grouped.set(record.activityId, []);
      }
      grouped.get(record.activityId)!.push(record);
    }

    logger.info(
      `Grouped ${records.length} meeting records into ${grouped.size} unique meetings`,
    );
    return grouped;
  }

  // ============= TASK METHODS =============

  /**
   * Read task records from Contacts Excel file
   */
  readTaskContactsFile(filePath: string): TaskRecord[] {
    logger.info("Reading Contacts Task file", { filePath });

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    const records: TaskRecord[] = data.map((row: any) => ({
      activityId:
        (row["Salesforce Activity ID"] || row["salesforce Activity ID"])
          ?.toString()
          .trim() || "",
      associationTypeId: parseInt(row["AssociationTypeId"]) || 204,
      salesforceId: row["Salesforce Contact ID"]?.toString().trim() || "",
      objectType: this.getObjectType(parseInt(row["AssociationTypeId"]) || 204),
      owner: row["owner"]?.toString().trim() || "",
      subject: row["hs_task_subject"]?.toString().trim() || "Task",
      timestamp: row["hs_timestamp"]?.toString().trim() || "",
      status: row["hs_task_status"]?.toString().trim() || "COMPLETED",
    }));

    logger.info(`Read ${records.length} contact task records from file`);

    // Filter out invalid records (must have activityId, salesforceId, and timestamp)
    const validRecords = records.filter((r) => {
      if (!r.activityId || !r.salesforceId || !r.timestamp) {
        logger.debug(
          `Skipping task with missing data: Activity=${r.activityId}, SF ID=${r.salesforceId}, Timestamp=${r.timestamp}`,
        );
        return false;
      }

      // Only keep Contact IDs (003 prefix)
      if (!r.salesforceId.startsWith("003")) {
        logger.debug(
          `Skipping non-Contact ID in Contacts file: ${r.salesforceId} (Activity: ${r.activityId})`,
        );
        return false;
      }

      return true;
    });

    logger.info(
      `Filtered to ${validRecords.length} valid contact task records (removed ${records.length - validRecords.length})`,
    );
    return validRecords;
  }

  /**
   * Read task records from Accounts Excel file
   */
  readTaskAccountsFile(filePath: string): TaskRecord[] {
    logger.info("Reading Accounts Task file", { filePath });

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    const records: TaskRecord[] = data.map((row: any) => ({
      activityId:
        (row["Salesforce Activity ID"] || row["salesforce Activity ID"])
          ?.toString()
          .trim() || "",
      associationTypeId: parseInt(row["AssociationTypeId"]) || 192,
      salesforceId: row["Salesforce Account ID"]?.toString().trim() || "",
      objectType: this.getObjectType(parseInt(row["AssociationTypeId"]) || 192),
      owner: row["owner"]?.toString().trim() || "",
      subject: row["hs_task_subject"]?.toString().trim() || "Task",
      timestamp: row["hs_timestamp"]?.toString().trim() || "",
      status: row["hs_task_status"]?.toString().trim() || "COMPLETED",
    }));

    logger.info(`Read ${records.length} account task records`);

    // Filter out invalid records (must have activityId, salesforceId, and timestamp)
    const validRecords = records.filter((r) => {
      if (!r.activityId || !r.salesforceId || !r.timestamp) {
        logger.debug(
          `Skipping task with missing data: Activity=${r.activityId}, SF ID=${r.salesforceId}, Timestamp=${r.timestamp}`,
        );
        return false;
      }
      return true;
    });

    logger.info(
      `Filtered to ${validRecords.length} valid account task records (removed ${records.length - validRecords.length})`,
    );
    return validRecords;
  }

  /**
   * Read task records from Opportunities Excel file
   */
  readTaskOpportunitiesFile(filePath: string): TaskRecord[] {
    logger.info("Reading Opportunities Task file", { filePath });

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    const records: TaskRecord[] = data.map((row: any) => ({
      activityId:
        (row["Salesforce Activity ID"] || row["salesforce Activity ID"])
          ?.toString()
          .trim() || "",
      associationTypeId: parseInt(row["AssociationTypeId"]) || 216,
      salesforceId: row["Salesforce Opportunity ID"]?.toString().trim() || "",
      objectType: this.getObjectType(parseInt(row["AssociationTypeId"]) || 216),
      owner: row["owner"]?.toString().trim() || "",
      subject: row["hs_task_subject"]?.toString().trim() || "Task",
      timestamp: row["hs_timestamp"]?.toString().trim() || "",
      status: row["hs_task_status"]?.toString().trim() || "COMPLETED",
    }));

    logger.info(`Read ${records.length} opportunity task records`);

    // Filter out invalid records (must have activityId, salesforceId, and timestamp)
    const validRecords = records.filter((r) => {
      if (!r.activityId || !r.salesforceId || !r.timestamp) {
        logger.debug(
          `Skipping task with missing data: Activity=${r.activityId}, SF ID=${r.salesforceId}, Timestamp=${r.timestamp}`,
        );
        return false;
      }
      return true;
    });

    logger.info(
      `Filtered to ${validRecords.length} valid opportunity task records (removed ${records.length - validRecords.length})`,
    );
    return validRecords;
  }

  /**
   * Read all task Excel files and combine records
   */
  readAllTaskFiles(
    contactsPath: string,
    accountsPath: string,
    opportunitiesPath: string,
  ): TaskRecord[] {
    const contactRecords = this.readTaskContactsFile(contactsPath);
    const accountRecords = this.readTaskAccountsFile(accountsPath);
    const opportunityRecords =
      this.readTaskOpportunitiesFile(opportunitiesPath);

    const allRecords = [
      ...contactRecords,
      ...accountRecords,
      ...opportunityRecords,
    ];

    logger.info("Total task records read from all files", {
      total: allRecords.length,
      contacts: contactRecords.length,
      accounts: accountRecords.length,
      opportunities: opportunityRecords.length,
    });

    return allRecords;
  }

  /**
   * Group task records by Activity ID
   * Returns Map of activityId -> array of records
   */
  groupTasksByActivityId(records: TaskRecord[]): Map<string, TaskRecord[]> {
    const grouped = new Map<string, TaskRecord[]>();

    for (const record of records) {
      if (!grouped.has(record.activityId)) {
        grouped.set(record.activityId, []);
      }
      grouped.get(record.activityId)!.push(record);
    }

    logger.info(
      `Grouped ${records.length} task records into ${grouped.size} unique tasks`,
    );
    return grouped;
  }
}

export default new ExcelReader();
