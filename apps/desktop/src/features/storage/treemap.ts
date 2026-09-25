/** Treemap "squarified" (Bruls, Huizing y van Wijk): rectángulos lo más cuadrados posible. */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Tile<T> extends Rect {
  item: T;
}

function worst(row: number[], side: number): number {
  const sum = row.reduce((a, b) => a + b, 0);
  const max = Math.max(...row);
  const min = Math.min(...row);
  const s2 = side * side;
  return Math.max((s2 * max) / (sum * sum), (sum * sum) / (s2 * min));
}

/** Reparte `rect` entre los ítems de forma proporcional a `value`. Los valores ≤ 0 se omiten. */
export function squarify<T>(items: T[], value: (item: T) => number, rect: Rect): Tile<T>[] {
  const list = items.filter((i) => value(i) > 0).sort((a, b) => value(b) - value(a));
  const total = list.reduce((s, i) => s + value(i), 0);
  if (!list.length || rect.w <= 0 || rect.h <= 0) return [];
  const scale = (rect.w * rect.h) / total;
  const areas = list.map((i) => value(i) * scale);
  const tiles: Tile<T>[] = [];
  let { x, y, w, h } = rect;
  let start = 0;

  while (start < areas.length) {
    const side = Math.min(w, h);
    let end = start + 1;
    while (end < areas.length && worst(areas.slice(start, end + 1), side) <= worst(areas.slice(start, end), side)) {
      end += 1;
    }
    const row = areas.slice(start, end);
    const sum = row.reduce((a, b) => a + b, 0);
    if (w >= h) {
      // Columna a la izquierda.
      const colW = sum / h;
      let cy = y;
      row.forEach((a, i) => {
        const th = a / colW;
        tiles.push({ x, y: cy, w: colW, h: th, item: list[start + i] });
        cy += th;
      });
      x += colW;
      w -= colW;
    } else {
      // Fila arriba.
      const rowH = sum / w;
      let cx = x;
      row.forEach((a, i) => {
        const tw = a / rowH;
        tiles.push({ x: cx, y, w: tw, h: rowH, item: list[start + i] });
        cx += tw;
      });
      y += rowH;
      h -= rowH;
    }
    start = end;
  }
  return tiles;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(v >= 10 ? 1 : 2)} ${units[u]}`;
}

export const percent = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

/** Camino desde la raíz hasta el nodo con `id` (para las migas). */
export function pathTo<T extends { id: string; children: T[] }>(root: T, id: string): T[] {
  if (root.id === id) return [root];
  for (const child of root.children) {
    const sub = pathTo(child, id);
    if (sub.length) return [root, ...sub];
  }
  return [];
}
