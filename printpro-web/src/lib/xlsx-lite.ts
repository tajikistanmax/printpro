// Минимальный генератор .xlsx БЕЗ внешних зависимостей.
// Собирает настоящий OOXML-файл (ZIP со STORE-упаковкой), который Excel/LibreOffice
// открывают без предупреждений о формате. Достаточно для выгрузки таблиц отчётов.

export type Cell = string | number | null | undefined;
export interface Sheet {
  name: string;
  rows: Cell[][]; // первая строка обычно — заголовки
}

// --- CRC32 (для записей ZIP) ---
function crc32(bytes: Uint8Array): number {
  let crc = ~0;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

// Ссылка на столбец по индексу: 0→A, 25→Z, 26→AA…
function colRef(n: number): string {
  let s = '';
  let x = n + 1;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Имя листа: Excel запрещает []:*?/\ и ограничивает 31 символом
function safeSheetName(name: string, i: number): string {
  const cleaned = (name || `Лист${i + 1}`).replace(/[[\]:*?/\\]/g, ' ').trim();
  return (cleaned || `Лист${i + 1}`).slice(0, 31);
}

function sheetXml(rows: Cell[][]): string {
  const rowsXml = rows
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          const ref = `${colRef(c)}${r + 1}`;
          if (v === null || v === undefined || v === '') return `<c r="${ref}"/>`;
          if (typeof v === 'number' && isFinite(v))
            return `<c r="${ref}"><v>${v}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`;
}

function u16(a: number[], v: number) {
  a.push(v & 255, (v >> 8) & 255);
}
function u32(a: number[], v: number) {
  a.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
}

export function buildXlsx(sheets: Sheet[]): Blob {
  const enc = new TextEncoder();
  const files: { name: string; data: Uint8Array }[] = [];
  const add = (name: string, str: string) =>
    files.push({ name, data: enc.encode(str) });

  const meta = sheets.map((s, i) => ({ name: safeSheetName(s.name, i), id: i + 1 }));

  add(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${meta
      .map(
        (s) =>
          `<Override PartName="/xl/worksheets/sheet${s.id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('')}</Types>`,
  );
  add(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  add(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${meta
      .map(
        (s) => `<sheet name="${esc(s.name)}" sheetId="${s.id}" r:id="rId${s.id}"/>`,
      )
      .join('')}</sheets></workbook>`,
  );
  add(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${meta
      .map(
        (s) =>
          `<Relationship Id="rId${s.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${s.id}.xml"/>`,
      )
      .join('')}</Relationships>`,
  );
  sheets.forEach((s, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows)));

  // Сборка ZIP (метод STORE — без сжатия)
  const out: number[] = [];
  const central: number[] = [];
  let offset = 0;
  for (const f of files) {
    const crc = crc32(f.data);
    const nameBytes = enc.encode(f.name);
    const local: number[] = [];
    u32(local, 0x04034b50);
    u16(local, 20);
    u16(local, 0);
    u16(local, 0);
    u16(local, 0);
    u16(local, 0);
    u32(local, crc);
    u32(local, f.data.length);
    u32(local, f.data.length);
    u16(local, nameBytes.length);
    u16(local, 0);
    for (const b of nameBytes) local.push(b);
    for (const b of local) out.push(b);
    for (const b of f.data) out.push(b);

    u32(central, 0x02014b50);
    u16(central, 20);
    u16(central, 20);
    u16(central, 0);
    u16(central, 0);
    u16(central, 0);
    u16(central, 0);
    u32(central, crc);
    u32(central, f.data.length);
    u32(central, f.data.length);
    u16(central, nameBytes.length);
    u16(central, 0);
    u16(central, 0);
    u16(central, 0);
    u16(central, 0);
    u32(central, 0);
    u32(central, offset);
    for (const b of nameBytes) central.push(b);

    offset += local.length + f.data.length;
  }
  const cdOffset = out.length;
  for (const b of central) out.push(b);
  const eocd: number[] = [];
  u32(eocd, 0x06054b50);
  u16(eocd, 0);
  u16(eocd, 0);
  u16(eocd, files.length);
  u16(eocd, files.length);
  u32(eocd, central.length);
  u32(eocd, cdOffset);
  u16(eocd, 0);
  for (const b of eocd) out.push(b);

  return new Blob([Uint8Array.from(out)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

// Скачать книгу как .xlsx
export function downloadXlsx(filename: string, sheets: Sheet[]) {
  const blob = buildXlsx(sheets);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
