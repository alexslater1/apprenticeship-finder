const cell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Download rows as a CSV file (Excel-friendly UTF-8 with BOM). */
export function downloadCsv(filename: string, header: string[], rows: unknown[][]): void {
  const text = [header, ...rows].map((r) => r.map(cell).join(',')).join('\n');
  const blob = new Blob([`\ufeff${text}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
