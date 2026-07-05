'use client';

/**
 * Драйвер текстового дисплея покупателя (VFD / линейный 2×20) через Web Serial API.
 *
 * Браузер (Chrome/Edge на Windows) сам открывает COM-порт и шлёт текст на
 * дисплей POS-терминала. Поддерживаются распространённые протоколы и кириллица
 * (CP866) либо безопасный транслит в латиницу.
 *
 * Работает только в защищённом контексте (https или localhost) и в Chromium.
 */

export type VfdProtocol = 'escpos' | 'cd5220' | 'aedex' | 'plain';
export type VfdCharset = 'latin' | 'cp866';

export type VfdConfig = {
  enabled: boolean;
  protocol: VfdProtocol;
  baud: number;
  charset: VfdCharset;
  width: number; // символов в строке (обычно 20, реже 16)
};

export const DEFAULT_VFD: VfdConfig = {
  enabled: false,
  protocol: 'escpos',
  baud: 9600,
  charset: 'latin',
  width: 20,
};

export const VFD_PROTOCOLS: { k: VfdProtocol; name: string; hint: string }[] = [
  { k: 'escpos', name: 'ESC/POS (Epson DM-D, большинство)', hint: 'Очистка + 40 символов в две строки' },
  { k: 'cd5220', name: 'CD5220 (Posiflex, Flytech и др.)', hint: 'Команды ESC Q A / ESC Q B' },
  { k: 'aedex', name: 'AEDEX / UTC-S', hint: 'Команды 0x04 0x01 / 0x04 0x02' },
  { k: 'plain', name: 'Простой текст (без команд)', hint: 'Для простых дисплеев — просто 40 символов' },
];

export const VFD_BAUDS = [9600, 19200, 38400, 57600, 115200, 2400, 4800];

/** Прочитать конфиг дисплея из объекта настроек. */
export function readVfdConfig(s: Record<string, string>): VfdConfig {
  return {
    enabled: s['display.vfd'] === 'true',
    protocol: (s['display.vfd.protocol'] as VfdProtocol) || DEFAULT_VFD.protocol,
    baud: Number(s['display.vfd.baud']) || DEFAULT_VFD.baud,
    charset: (s['display.vfd.charset'] as VfdCharset) || DEFAULT_VFD.charset,
    width: Number(s['display.vfd.width']) || DEFAULT_VFD.width,
  };
}

// ------------------------------------------------------------------
//  Доступность и порт
// ------------------------------------------------------------------
export function vfdSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

let activePort: any = null;
let activeWriter: any = null;
let openedBaud = 0;

/** Запросить у пользователя COM-порт (требует клика). Сохраняется браузером. */
export async function requestVfdPort(): Promise<boolean> {
  if (!vfdSupported()) return false;
  const port = await (navigator as any).serial.requestPort();
  if (!port) return false;
  activePort = port;
  return true;
}

/** Ранее выданный порт (без запроса) — если пользователь уже разрешил. */
async function getGrantedPort() {
  if (!vfdSupported()) return null;
  if (activePort) return activePort;
  const ports = await (navigator as any).serial.getPorts();
  activePort = ports[0] ?? null;
  return activePort;
}

async function ensureWriter(baud: number) {
  const port = await getGrantedPort();
  if (!port) return null;
  try {
    if (!port.writable || openedBaud !== baud) {
      // переоткрыть при смене скорости
      if (port.writable && openedBaud !== baud) {
        try {
          activeWriter?.releaseLock?.();
        } catch {
          /* ignore */
        }
        activeWriter = null;
        try {
          await port.close();
        } catch {
          /* ignore */
        }
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

/** Отключить дисплей (закрыть порт). */
export async function vfdDisconnect() {
  try {
    activeWriter?.releaseLock?.();
  } catch {
    /* ignore */
  }
  activeWriter = null;
  try {
    await activePort?.close?.();
  } catch {
    /* ignore */
  }
  openedBaud = 0;
}

// ------------------------------------------------------------------
//  Кодирование текста
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
    if (t == null) {
      out += ch;
    } else {
      out += ch === lower ? t : t.toUpperCase();
    }
  }
  return out;
}

function cp866(ch: string): number | null {
  const c = ch.codePointAt(0)!;
  if (c >= 0x410 && c <= 0x41f) return 0x80 + (c - 0x410); // А-П
  if (c >= 0x420 && c <= 0x42f) return 0x90 + (c - 0x420); // Р-Я
  if (c >= 0x430 && c <= 0x43f) return 0xa0 + (c - 0x430); // а-п
  if (c >= 0x440 && c <= 0x44f) return 0xe0 + (c - 0x440); // р-я
  if (c === 0x401) return 0xf0; // Ё
  if (c === 0x451) return 0xf1; // ё
  return null;
}

function encodeText(s: string, charset: VfdCharset): number[] {
  const src = charset === 'latin' ? translit(s) : s;
  const out: number[] = [];
  for (const ch of src) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) {
      out.push(code);
    } else if (charset === 'cp866') {
      out.push(cp866(ch) ?? 0x3f); // '?'
    } else {
      out.push(0x3f);
    }
  }
  return out;
}

function pad(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : s.padEnd(n);
}

function frame(l1: string, l2: string, cfg: VfdConfig): Uint8Array {
  const w = cfg.width;
  const t1 = pad(l1, w);
  const t2 = pad(l2, w);
  const enc = (s: string) => encodeText(s, cfg.charset);
  const ESC = 0x1b;
  let bytes: number[];

  if (cfg.protocol === 'cd5220') {
    bytes = [
      ESC, 0x40, // ESC @ — инициализация
      ESC, 0x51, 0x41, ...enc(t1.trimEnd()), 0x0d, // верхняя строка
      ESC, 0x51, 0x42, ...enc(t2.trimEnd()), 0x0d, // нижняя строка
    ];
  } else if (cfg.protocol === 'aedex') {
    bytes = [
      0x04, 0x01, ...enc(t1), 0x0d, // верхняя строка
      0x04, 0x02, ...enc(t2), 0x0d, // нижняя строка
    ];
  } else if (cfg.protocol === 'plain') {
    bytes = [...enc(t1), ...enc(t2)];
  } else {
    // escpos / generic: очистка (0x0C) + 40 символов авто-переносом
    bytes = [0x0c, ...enc(t1 + t2)];
  }
  return new Uint8Array(bytes);
}

// ------------------------------------------------------------------
//  Вывод
// ------------------------------------------------------------------
/** Показать две строки на дисплее. Тихо выходит, если выключено/нет порта. */
export async function vfdShow(line1: string, line2: string, cfg: VfdConfig) {
  if (!cfg.enabled || !vfdSupported()) return;
  const writer = await ensureWriter(cfg.baud);
  if (!writer) return;
  try {
    await writer.write(frame(line1, line2, cfg));
  } catch {
    // порт мог отвалиться — сбросим, чтобы переоткрыть в следующий раз
    activeWriter = null;
    openedBaud = 0;
  }
}

/** Тестовая надпись — чтобы проверить порт/протокол на месте. */
export async function vfdTest(cfg: VfdConfig) {
  // принудительно enabled для теста
  await vfdShow('PrintPro  касса', 'Тест 1 2 3   480 c.', { ...cfg, enabled: true });
}
