import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import type { ResourceColumn, ResourceRow } from './types';

const ASSET_TEMPLATE_COLUMNS = [
  'asset_number',
  'name',
  'asset_type',
  'status',
  'client_id',
  'functional_location',
  'serial_number',
  'manufacturer',
  'model',
  'description',
  'notes',
] as const;

export type AssetImportRecord = Record<(typeof ASSET_TEMPLATE_COLUMNS)[number], string>;

function safeText(value: string | number | null | undefined) {
  return String(value ?? '').trim();
}

function normalizeHeader(value: string | number | null | undefined) {
  return safeText(value)
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function sanitizeFileName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function textContains(haystack: string | number | null | undefined, needle: string) {
  return safeText(haystack).toLowerCase().includes(needle.trim().toLowerCase());
}

export function uniqueValues(rows: ResourceRow[], key: string) {
  return Array.from(new Set(rows.map((row) => safeText(row[key])).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export function matchesDate(value: string | number | null | undefined, selectedDate: string) {
  if (!selectedDate) {
    return true;
  }

  const raw = safeText(value);
  if (!raw) {
    return false;
  }

  const iso = raw.slice(0, 10);
  return iso === selectedDate;
}

export function daysUntil(value: string | number | null | undefined) {
  const raw = safeText(value);
  if (!raw) {
    return Number.POSITIVE_INFINITY;
  }

  const target = new Date(raw);
  if (Number.isNaN(target.getTime())) {
    return Number.POSITIVE_INFINITY;
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = target.getTime() - startOfToday.getTime();
  return Math.ceil(diff / 86400000);
}

export function toCsvString(columns: ResourceColumn[], rows: ResourceRow[]) {
  const escapeCell = (value: string | number | null | undefined) => {
    const text = String(value ?? '');
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const header = columns.map((column) => escapeCell(column.label)).join(',');
  const body = rows.map((row) => columns.map((column) => escapeCell(row[column.key])).join(',')).join('\n');
  return [header, body].filter(Boolean).join('\n');
}

export function exportRowsToCsv(title: string, columns: ResourceColumn[], rows: ResourceRow[]) {
  const csv = toCsvString(columns, rows);
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${sanitizeFileName(title)}-current-view.csv`);
}

export function exportRowsToPdf(title: string, subtitle: string, columns: ResourceColumn[], rows: ResourceRow[]) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const generatedAt = new Date().toLocaleString();

  doc.setFillColor(20, 41, 63);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 74, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('RG', 34, 34);
  doc.setFontSize(17);
  doc.text('Rigways Group', 72, 28);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Asset & Certificate Management Report', 72, 46);

  doc.setTextColor(47, 55, 66);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(title, 34, 108);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(subtitle, 34, 126);
  doc.text(`Generated: ${generatedAt}`, doc.internal.pageSize.getWidth() - 180, 108);
  doc.text(`Rows: ${rows.length}`, doc.internal.pageSize.getWidth() - 180, 126);

  autoTable(doc, {
    startY: 144,
    head: [columns.map((column) => column.label)],
    body: rows.map((row) => columns.map((column) => safeText(row[column.key]))),
    styles: {
      fontSize: 8,
      cellPadding: 6,
      textColor: [47, 55, 66],
      lineColor: [224, 230, 238],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [20, 41, 63],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'left',
    },
    alternateRowStyles: {
      fillColor: [248, 251, 255],
    },
    margin: { left: 34, right: 34, bottom: 30 },
    didDrawPage: (data) => {
      doc.setFontSize(9);
      doc.setTextColor(121, 135, 153);
      doc.text(`Page ${doc.getCurrentPageInfo().pageNumber}`, data.settings.margin.left, doc.internal.pageSize.getHeight() - 12);
    },
  });

  doc.save(`${sanitizeFileName(title)}-current-view.pdf`);
}

export async function parseSpreadsheetFile(file: File): Promise<Record<string, string>[]> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, string | number | null>>(sheet, { defval: '' });

  return rows
    .map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeHeader(key), safeText(value)])))
    .filter((row) => Object.values(row).some((value) => safeText(value)));
}

export function assetTemplateRecords(): AssetImportRecord[] {
  return [
    {
      asset_number: 'AST-9001',
      name: 'Top Drive Backup Unit',
      asset_type: 'Drilling Equipment',
      status: 'operation',
      client_id: 'C001',
      functional_location: 'FL-C001-010',
      serial_number: 'SN-C001-9001',
      manufacturer: 'NOV',
      model: 'TDX-4',
      description: 'Backup unit for main top drive assembly',
      notes: 'Imported sample row',
    },
  ];
}

export function downloadAssetTemplate(format: 'csv' | 'xlsx') {
  const rows = assetTemplateRecords();

  if (format === 'csv') {
    const csv = toCsvString(ASSET_TEMPLATE_COLUMNS.map((key) => ({ key, label: key })), rows);
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'rigways-assets-template.csv');
    return;
  }

  const worksheet = XLSX.utils.json_to_sheet(rows, { header: [...ASSET_TEMPLATE_COLUMNS] });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Assets');
  XLSX.writeFile(workbook, 'rigways-assets-template.xlsx');
}

export function pickRecordValue(record: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const value = safeText(record[key]);
    if (value) {
      return value;
    }
  }
  return '';
}
