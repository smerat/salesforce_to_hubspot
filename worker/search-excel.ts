import * as XLSX from "xlsx";

const searchIds = [
  '0034x0000090bGfAAI',
  '0034x00000DnmXRAAZ',
  '0034x00000iLzdtAAC',
];

const files = [
  "../data/call-data/Calls - Contacts-Migration List.xlsx",
  "../data/call-data/Calls - Accounts- Migration List.xlsx",
  "../data/call-data/Calls - Opportunities-Migration List.xlsx",
];

console.log("Searching for missing contact IDs in Excel files...\n");

for (const file of files) {
  console.log(`\n📁 Searching in: ${file}`);
  try {
    const workbook = XLSX.readFile(file);
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    // Check first row to see column names
    if (data.length > 0) {
      console.log("Columns:", Object.keys(data[0]));
    }

    for (const searchId of searchIds) {
      // Search for 15-char version (remove last 3 chars)
      const id15 = searchId.substring(0, 15);
      const id18 = searchId;

      const found = data.filter((row: any) => {
        const contactId = row["Salesforce Contact ID"]?.toString().trim() || "";
        const accountId = row["Salesforce Account ID"]?.toString().trim() || "";
        const opportunityId = row["Salesforce Opportunity ID"]?.toString().trim() || "";

        return contactId === id15 || contactId === id18 ||
               accountId === id15 || accountId === id18 ||
               opportunityId === id15 || opportunityId === id18;
      });

      if (found.length > 0) {
        console.log(`\n✓ Found ${searchId}:`);
        console.log(JSON.stringify(found[0], null, 2));
      }
    }
  } catch (error: any) {
    console.error(`Error reading ${file}:`, error.message);
  }
}

console.log("\n✅ Search complete");
