import type { Sound } from "@/lib/api";

export const ATTRIBUTION_EXAMPLE =
  '"Tranquility" Kevin MacLeod (incompetech.com)\nLicensed under Creative Commons: By Attribution 4.0 License\nhttp://creativecommons.org/licenses/by/4.0/';

const CC_NAMES: Record<string, string> = {
  attribution: "CC BY",
  "attribution-sharealike": "CC BY-SA",
  "attribution-noderivs": "CC BY-ND",
  "attribution-noncommercial": "CC BY-NC",
  "attribution-noncommercial-sharealike": "CC BY-NC-SA",
  "attribution-noncommercial-noderivs": "CC BY-NC-ND",
};

export interface ParsedAttribution {
  title?: string;
  author?: string;
  license?: string;
  license_url?: string;
}

/** Igual que `parse_attribution` del núcleo: solo para mostrar lo que se va a completar. */
export function parseAttribution(text: string): ParsedAttribution {
  const out: ParsedAttribution = {};
  const first = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const m = first.match(/^[«"“]([^"”»]+)[»"”]\s*(?:by\s+|de\s+|-\s*|—\s*)?([^()\n—–|,]*)/i);
  if (m) {
    out.title = m[1].trim();
    const author = m[2].trim().replace(/^[\s\-—,]+|[\s\-—,]+$/g, "");
    if (author) out.author = author;
  }
  const lic = text.match(/creative commons:?\s*([a-z\- ]+?)\s*(\d(?:\.\d)?)/i);
  if (lic) {
    const key = lic[1].trim().toLowerCase().replace(/\s+/g, " ").replace(/^by /, "");
    const kind = CC_NAMES[key];
    if (kind) out.license = `${kind} ${lic[2]}`;
  } else if (/\bCC0\b|dominio p[uú]blico|public domain/i.test(text)) {
    out.license = "Dominio público (CC0)";
  }
  const urls = text.match(/https?:\/\/\S+/g);
  if (urls) out.license_url = urls[urls.length - 1].replace(/[.,)]+$/, "");
  return out;
}

/** Bloque para pegar en una descripción: cada atribución separada por una línea en blanco. */
export function attributionsText(sounds: Sound[]): string {
  return sounds
    .map((s) => s.attribution?.trim())
    .filter(Boolean)
    .join("\n\n");
}
