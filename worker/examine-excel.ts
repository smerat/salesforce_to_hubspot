import * as XLSX from 'xlsx';
import * as path from 'path';

const files = [
  '../data/call-data/Calls - Contacts-Migration List.xlsx',
  '../data/call-data/Calls - Accounts- Migration List.xlsx',
  '../data/call-data/Calls - Opportunities-Migration List.xlsx'
];

files.forEach((file) => {
  console.log('\n' + '='.repeat(80));
  console.log(`FILE: ${path.basename(file)}`);
  console.log('='.repeat(80));

  const workbook = XLSX.readFile(file);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Get range
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
  console.log(`Rows: ${range.e.r + 1}`);

  // Get headers (first row)
  const headers: string[] = [];
  for (let col = range.s.c; col <= range.e.c; col++) {
    const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
    const cell = worksheet[cellAddress];
    if (cell) {
      headers.push(cell.v);
    }
  }

  console.log(`Columns: ${headers.length}`);
  console.log('\nHeaders:');
  headers.forEach((h, i) => console.log(`  ${i + 1}. ${h}`));

  // Get first 3 data rows as sample
  const data = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
  console.log(`\nTotal Records: ${data.length}`);
  console.log('\nSample Records (first 3):');
  console.log(JSON.stringify(data.slice(0, 3), null, 2));
});
