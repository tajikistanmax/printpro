'use client';

/**
 * Термопечать чеков ESC/POS через Web Serial API.
 *
 * Отдельный от VFD порт (это другой физический прибор — чековый принтер 58/80 мм).
 * Кириллица: CP866 (типично для термопринтеров) или транслит в латиницу.
 * Работает в Chrome/Edge на Windows (localhost/https).
 */

export type EscposCharset = 'cp866' | 'latin';

export type EscposConfig = {
  enabled: boolean;
  baud: number;
  charset: EscposCharset;
  width: number; // символов в строке: 32 (58 мм) или 48 (80 мм)
  codepage: number; // ESC t n — кодовая страница принтера для кириллицы
  cut: boolean; // авто-обрезка после печати
  autoPrint: boolean; // печатать чек сразу после продажи
};

export const DEFAULT_ESCPOS: EscposConfig = {
  enabled: false,
  baud: 9600,
  charset: 'cp866',
  width: 32,
  codepage: 17,
  cut: true,
  autoPrint: false,
};

export const ESCPOS_BAUDS = [9600, 19200, 38400, 57600, 115200];
// Частые кодовые страницы принтеров для кириллицы (ESC t n)
export const ESCPOS_CODEPAGES: { n: number; name: string }[] = [
  { n: 17, name: '17 — PC866 (частый)' },
  { n: 7, name: '7 — PC866 (альт.)' },
  { n: 6, name: '6 — PC866 (альт.)' },
  { n: 73, name: '73 — CP866 (Epson)' },
];

export type ReceiptData = {
  shopName: string;
  address?: string;
  phone?: string;
  inn?: string;
  orderNumber: string;
  receiptNumber?: string;
  hasService?: boolean; // есть услуга → печатаем и номер заказа (по нему заберут готовое)
  date: string;
  items: Array<{ name: string; qty: number; total: number }>;
  total: number;
  method?: string;
  onlineUrl?: string;
};

export function readEscposConfig(s: Record<string, string>): EscposConfig {
  return {
    enabled: s['escpos.enabled'] === 'true',
    baud: Number(s['escpos.baud']) || DEFAULT_ESCPOS.baud,
    charset: (s['escpos.charset'] as EscposCharset) || DEFAULT_ESCPOS.charset,
    width: Number(s['escpos.width']) || DEFAULT_ESCPOS.width,
    codepage: Number(s['escpos.codepage']) || DEFAULT_ESCPOS.codepage,
    cut: s['escpos.cut'] !== 'false',
    autoPrint: s['escpos.autoPrint'] === 'true',
  };
}

// ------------------------------------------------------------------
//  Доступность и порт
// ------------------------------------------------------------------
export function escposSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let activePort: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let activeWriter: any = null;
let openedBaud = 0;

export async function requestEscposPort(): Promise<boolean> {
  if (!escposSupported()) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const port = await (navigator as any).serial.requestPort();
  if (!port) return false;
  activePort = port;
  return true;
}

async function getGrantedPort() {
  if (!escposSupported()) return null;
  if (activePort) return activePort;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ports = await (navigator as any).serial.getPorts();
  activePort = ports[0] ?? null;
  return activePort;
}

async function ensureWriter(baud: number) {
  const port = await getGrantedPort();
  if (!port) return null;
  try {
    if (!port.writable || openedBaud !== baud) {
      if (port.writable && openedBaud !== baud) {
        try { activeWriter?.releaseLock?.(); } catch { /* ignore */ }
        activeWriter = null;
        try { await port.close(); } catch { /* ignore */ }
      }
      await port.open({ baudRate: baud });
      openedBaud = baud;
    }
    if (!activeWriter) activeWriter = port.writable.getWriter();
    return activeWriter;
  } catch {
    return null;
  }
}

export async function escposDisconnect() {
  try { activeWriter?.releaseLock?.(); } catch { /* ignore */ }
  activeWriter = null;
  try { await activePort?.close?.(); } catch { /* ignore */ }
  openedBaud = 0;
}

// ------------------------------------------------------------------
//  Кодирование текста (латиница-транслит или CP866)
// ------------------------------------------------------------------
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function translit(s: string): string {
  let out = '';
  for (const ch of s) {
    const lower = ch.toLowerCase();
    const t = TRANSLIT[lower];
    out += t == null ? ch : ch === lower ? t : t.toUpperCase();
  }
  return out;
}

function cp866(ch: string): number | null {
  const c = ch.codePointAt(0)!;
  if (c >= 0x410 && c <= 0x41f) return 0x80 + (c - 0x410);
  if (c >= 0x420 && c <= 0x42f) return 0x90 + (c - 0x420);
  if (c >= 0x430 && c <= 0x43f) return 0xa0 + (c - 0x430);
  if (c >= 0x440 && c <= 0x44f) return 0xe0 + (c - 0x440);
  if (c === 0x401) return 0xf0;
  if (c === 0x451) return 0xf1;
  return null;
}

function encodeText(s: string, charset: EscposCharset): number[] {
  const src = charset === 'latin' ? translit(s) : s;
  const out: number[] = [];
  for (const ch of src) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) out.push(code);
    else if (charset === 'cp866') out.push(cp866(ch) ?? 0x3f);
    else out.push(0x3f);
  }
  return out;
}

// ------------------------------------------------------------------
//  Сборка чека
// ------------------------------------------------------------------
function money(n: number) {
  return new Intl.NumberFormat('ru-RU').format(n) + ' c.';
}

function twoCols(left: string, right: string, width: number): string {
  const space = width - left.length - right.length;
  if (space >= 1) return left + ' '.repeat(space) + right;
  const l = left.slice(0, Math.max(0, width - right.length - 1));
  return l + ' ' + right;
}

const ESC = 0x1b;
const GS = 0x1d;

function buildReceipt(r: ReceiptData, cfg: EscposConfig): Uint8Array {
  const bytes: number[] = [];
  const enc = (s: string) => encodeText(s, cfg.charset);
  const text = (s: string) => bytes.push(...enc(s));
  const nl = () => bytes.push(0x0a);
  const line = () => { text('-'.repeat(cfg.width)); nl(); };
  const align = (n: 0 | 1 | 2) => bytes.push(ESC, 0x61, n); // лево/центр/право
  const bold = (on: boolean) => bytes.push(ESC, 0x45, on ? 1 : 0);
  const size = (big: boolean) => bytes.push(GS, 0x21, big ? 0x11 : 0x00); // двойная в/ш

  bytes.push(ESC, 0x40); // init
  bytes.push(ESC, 0x74, cfg.codepage); // кодовая страница

  // Шапка
  align(1);
  size(true); bold(true); text(r.shopName); nl(); bold(false); size(false);
  if (r.address) { text(r.address); nl(); }
  if (r.phone) { text('тел. ' + r.phone); nl(); }
  if (r.inn) { text('ИНН ' + r.inn); nl(); }
  nl();

  // Реквизиты чека
  align(0);
  line();
  if (r.receiptNumber) { text(twoCols('Чек', r.receiptNumber, cfg.width)); nl(); }
  // Номер заказа — только если есть услуга (изготовление) или нет номера чека
  if (r.hasService || !r.receiptNumber) {
    text(twoCols('Заказ', '№' + r.orderNumber, cfg.width)); nl();
  }
  text(twoCols('Дата', r.date, cfg.width)); nl();
  line();

  // Позиции
  for (const it of r.items) {
    text(it.name); nl();
    text(twoCols(`  ${it.qty} шт`, money(it.total), cfg.width)); nl();
  }
  line();

  // Итого
  bold(true); size(true);
  text(twoCols('ИТОГО', money(r.total), Math.floor(cfg.width / 2)));
  size(false); nl(); bold(false);
  if (r.method) { text(twoCols('Оплата', r.method, cfg.width)); nl(); }

  // Подвал
  nl();
  align(1);
  if (r.onlineUrl) { text('Чек онлайн:'); nl(); text(r.onlineUrl); nl(); nl(); }
  text('Спасибо за покупку!'); nl();

  // Промотка и обрезка
  bytes.push(0x0a, 0x0a, 0x0a);
  if (cfg.cut) bytes.push(GS, 0x56, 0x00); // полная обрезка

  return new Uint8Array(bytes);
}

// ------------------------------------------------------------------
//  Печать
// ------------------------------------------------------------------
export async function escposPrint(r: ReceiptData, cfg: EscposConfig) {
  if (!escposSupported()) return false;
  const writer = await ensureWriter(cfg.baud);
  if (!writer) return false;
  try {
    await writer.write(buildReceipt(r, cfg));
    return true;
  } catch {
    activeWriter = null;
    openedBaud = 0;
    return false;
  }
}

export async function escposTest(cfg: EscposConfig) {
  const demo: ReceiptData = {
    shopName: 'PrintPro',
    address: 'г. Душанбе',
    phone: '+992 000 00 00 00',
    orderNumber: 'TEST',
    date: new Date().toLocaleString('ru-RU'),
    items: [
      { name: 'Печать А4', qty: 100, total: 180 },
      { name: 'Баннер 1x2 м', qty: 1, total: 300 },
    ],
    total: 480,
    method: 'Наличные',
  };
  return escposPrint(demo, { ...cfg, enabled: true });
}
