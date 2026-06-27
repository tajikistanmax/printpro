// Единый формат номеров документов: <PREFIX>-<УЗЕЛ>-<ГОД>-<NNNN>.
// Префикс узла (NODE_ID) исключает коллизии между точками сети.
export function docNumber(prefix: string, seq: number, pad = 4): string {
  const node = (process.env.NODE_ID ?? 'C').toUpperCase();
  const year = new Date().getFullYear();
  return `${prefix}-${node}-${year}-${String(seq).padStart(pad, '0')}`;
}
