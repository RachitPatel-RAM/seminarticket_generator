const ExcelJS = require('exceljs');
const fs = require('fs');

async function checkExcel() {
    const filename = 'registrations.xlsx';
    if (!fs.existsSync(filename)) {
        console.log('File does not exist.');
        return;
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filename);
    const worksheet = workbook.getWorksheet('Registrations');
    if (worksheet) {
        console.log(`Total Rows (including header): ${worksheet.rowCount}`);
        console.log(`Registration Count (Rows - 1): ${worksheet.rowCount - 1}`);
        worksheet.eachRow((row, rowNumber) => {
            console.log(`Row ${rowNumber}: ${row.values}`);
        });

        // Try to write to confirm lock
        try {
            worksheet.addRow(['Test', 'Lock Check']);
            await workbook.xlsx.writeFile(filename);
            console.log('Test Write Successful - File is NOT locked.');
        } catch (err) {
            console.error('Test Write Failed - File IS LOCKED:', err.message);
        }
    } else {
        console.log('Worksheet "Registrations" not found.');
    }
}

checkExcel();
