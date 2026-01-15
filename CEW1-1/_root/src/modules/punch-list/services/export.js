/**
 * Export Service for Punch List
 * Provides PDF and Excel export functionality for punch lists.
 */

import jsPDF from 'jspdf';
import 'jspdf-autotable';
import ExcelJS from 'exceljs';

/**
 * Formats a date for display.
 * @param {string|Date} date
 * @returns {string}
 */
function formatDate(date) {
    if (!date) return '-';
    const d = new Date(date);
    return d.toLocaleDateString('tr-TR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

/**
 * Exports a punch list to PDF.
 * @param {Object} historyRecord - The history record containing punch list data
 * @param {string} historyRecord.name - Name of the punch list
 * @param {Array} historyRecord.punches - Array of punch objects
 * @param {string} historyRecord.createdAt - Creation date
 */
export async function exportToPdf(historyRecord) {
    const doc = new jsPDF();
    const { name, punches, createdAt } = historyRecord;

    // Title
    doc.setFontSize(18);
    doc.text(`Punch List: ${name || 'Unnamed'}`, 14, 22);

    // Subtitle with date
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Created: ${formatDate(createdAt)}`, 14, 30);
    doc.text(`Total Punches: ${punches.length}`, 14, 36);

    // Summary stats
    const openCount = punches.filter(p => !p.completed).length;
    const closedCount = punches.filter(p => p.completed).length;
    doc.text(`Open: ${openCount} | Closed: ${closedCount}`, 14, 42);

    // Table data
    const tableHeaders = [
        'Punch No',
        'Date & Time',
        'Contractor',
        'Discipline',
        'Description',
        'Status',
    ];

    const tableRows = punches.map((punch, index) => [
        punch.punchNo || `#${index + 1}`,
        formatDate(punch.createdAt),
        punch.contractorName || '-',
        punch.discipline || '-',
        punch.description || '-',
        punch.completed ? 'Closed' : 'Open',
    ]);

    // Add table
    doc.autoTable({
        head: [tableHeaders],
        body: tableRows,
        startY: 50,
        styles: {
            fontSize: 8,
            cellPadding: 2,
        },
        headStyles: {
            fillColor: [66, 66, 66],
            textColor: 255,
            fontStyle: 'bold',
        },
        alternateRowStyles: {
            fillColor: [245, 245, 245],
        },
        columnStyles: {
            0: { cellWidth: 20 },
            1: { cellWidth: 35 },
            2: { cellWidth: 30 },
            3: { cellWidth: 25 },
            4: { cellWidth: 55 },
            5: { cellWidth: 15 },
        },
    });

    // Save file
    const filename = `punch-list-${name || 'export'}-${Date.now()}.pdf`;
    doc.save(filename);
}

/**
 * Exports a punch list to Excel.
 * @param {Object} historyRecord - The history record containing punch list data
 */
export async function exportToExcel(historyRecord) {
    const { name, punches, createdAt } = historyRecord;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CEW Punch List';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Punch List');

    // Header row
    worksheet.columns = [
        { header: 'Punch No', key: 'punchNo', width: 12 },
        { header: 'Date & Time', key: 'dateTime', width: 20 },
        { header: 'Contractor', key: 'contractor', width: 20 },
        { header: 'Discipline', key: 'discipline', width: 15 },
        { header: 'Description', key: 'description', width: 40 },
        { header: 'Status', key: 'status', width: 10 },
        { header: 'Photo', key: 'photo', width: 30 },
    ];

    // Style header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF424242' },
    };

    // Add punch data rows
    punches.forEach((punch, index) => {
        worksheet.addRow({
            punchNo: punch.punchNo || `#${index + 1}`,
            dateTime: formatDate(punch.createdAt),
            contractor: punch.contractorName || '-',
            discipline: punch.discipline || '-',
            description: punch.description || '-',
            status: punch.completed ? 'Closed' : 'Open',
            photo: punch.photoUrl || '-',
        });
    });

    // Apply alternating row colors
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1 && rowNumber % 2 === 0) {
            row.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFF5F5F5' },
            };
        }
    });

    // Add summary row at end
    const summaryRowNum = punches.length + 3;
    worksheet.getCell(`A${summaryRowNum}`).value = 'Summary';
    worksheet.getCell(`A${summaryRowNum}`).font = { bold: true };
    worksheet.getCell(`B${summaryRowNum}`).value = `Total: ${punches.length}`;
    worksheet.getCell(`C${summaryRowNum}`).value = `Open: ${punches.filter(p => !p.completed).length}`;
    worksheet.getCell(`D${summaryRowNum}`).value = `Closed: ${punches.filter(p => p.completed).length}`;

    // Generate and download file
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const filename = `punch-list-${name || 'export'}-${Date.now()}.xlsx`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * Exports all history records as a summary to Excel.
 * @param {Array} historyRecords - Array of history records
 */
export async function exportAllHistoryToExcel(historyRecords) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CEW Punch List';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('All History Summary');

    // Header row
    worksheet.columns = [
        { header: 'Punch List Name', key: 'name', width: 30 },
        { header: 'First Created', key: 'createdAt', width: 20 },
        { header: 'Last Updated', key: 'updatedAt', width: 20 },
        { header: 'Total Punches', key: 'totalPunches', width: 15 },
        { header: 'Open', key: 'open', width: 10 },
        { header: 'Closed', key: 'closed', width: 10 },
    ];

    // Style header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF424242' },
    };

    // Add history data rows
    historyRecords.forEach(record => {
        const openCount = record.punches.filter(p => !p.completed).length;
        const closedCount = record.punches.filter(p => p.completed).length;

        worksheet.addRow({
            name: record.name || 'Unnamed',
            createdAt: formatDate(record.createdAt),
            updatedAt: formatDate(record.updatedAt || record.createdAt),
            totalPunches: record.punches.length,
            open: openCount,
            closed: closedCount,
        });
    });

    // Generate and download file
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const filename = `punch-list-all-history-${Date.now()}.xlsx`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * Exports all history records as a summary to PDF.
 * @param {Array} historyRecords - Array of history records
 */
export async function exportAllHistoryToPdf(historyRecords) {
    const doc = new jsPDF();

    // Title
    doc.setFontSize(18);
    doc.text('Punch List - All History Summary', 14, 22);

    // Subtitle
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Generated: ${formatDate(new Date())}`, 14, 30);
    doc.text(`Total Records: ${historyRecords.length}`, 14, 36);

    // Table data
    const tableHeaders = [
        'Punch List Name',
        'First Created',
        'Last Updated',
        'Total',
        'Open',
        'Closed',
    ];

    const tableRows = historyRecords.map(record => {
        const openCount = record.punches.filter(p => !p.completed).length;
        const closedCount = record.punches.filter(p => p.completed).length;

        return [
            record.name || 'Unnamed',
            formatDate(record.createdAt),
            formatDate(record.updatedAt || record.createdAt),
            record.punches.length.toString(),
            openCount.toString(),
            closedCount.toString(),
        ];
    });

    // Add table
    doc.autoTable({
        head: [tableHeaders],
        body: tableRows,
        startY: 44,
        styles: {
            fontSize: 9,
            cellPadding: 3,
        },
        headStyles: {
            fillColor: [66, 66, 66],
            textColor: 255,
            fontStyle: 'bold',
        },
        alternateRowStyles: {
            fillColor: [245, 245, 245],
        },
    });

    // Save file
    const filename = `punch-list-all-history-${Date.now()}.pdf`;
    doc.save(filename);
}

export default {
    exportToPdf,
    exportToExcel,
    exportAllHistoryToExcel,
    exportAllHistoryToPdf,
};
