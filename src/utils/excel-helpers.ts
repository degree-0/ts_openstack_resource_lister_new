import { Worksheet, Column } from 'exceljs';

interface TableColumn extends Partial<Column> {
    name: string;
}

interface CreateTableOptions {
    worksheet: Worksheet;
    name: string;
    ref: string;
    columns: TableColumn[];
    rows: any[][];
    totalsRow?: boolean;
}

export function createTable(options: CreateTableOptions) {
    const { worksheet, name, ref, columns, rows, totalsRow } = options;

    console.log(`[excel-helpers] Creating table '${name}' at ${ref} with ${rows.length} rows.`);

    const table = worksheet.addTable({
        name: name,
        displayName: name,
        ref: ref,
        headerRow: true,
        totalsRow: false,
        style: {
            theme: 'TableStyleLight15',
            showFirstColumn: true,
            showLastColumn: true,
            showRowStripes: true,
            showColumnStripes: false,
        },
        columns: columns,
        rows: rows,
    });

    // table.commit() is deprecated and shouldn't be used. 
    // The table is automatically managed by the worksheet.

    console.log(`[excel-helpers] ✅ Table '${name}' created successfully!`);

    return table;
} 