import * as XLSX from "xlsx";

const files = [
  "../data/email-data/Emails - Contacts-Migration List.xlsx",
  "../data/email-data/Emails - Accounts- Migration List.xlsx",
  "../data/email-data/Emails - Opportunities-Migration List.xlsx",
];

console.log("=== Inspecting Email Excel Files ===\n");

for (const file of files) {
  console.log(`\n📁 File: ${file}`);
  try {
    const workbook = XLSX.readFile(file);
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    console.log(`   Sheet: ${sheetName}`);
    console.log(`   Total rows: ${data.length}`);

    if (data.length > 0) {
      console.log(`   Columns:`, Object.keys(data[0]));
      console.log(`\n   Sample row (first):`);
      console.log(JSON.stringify(data[0], null, 2));

      if (data.length > 1) {
        console.log(`\n   Sample row (second):`);
        console.log(JSON.stringify(data[1], null, 2));
      }
    }
  } catch (error: any) {
    console.error(`   Error: ${error.message}`);
  }
}

console.log("\n✅ Inspection complete");
