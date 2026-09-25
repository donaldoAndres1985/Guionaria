const URL_RE = /^https?:\/\/\S+$/i;

export function urlFromText(text: string | null | undefined): string | null {
  const value = (text ?? "").trim();
  return URL_RE.test(value) ? value : null;
}

/**
 * URL de lo que se soltó o pegó. Al arrastrar una imagen desde el navegador llega como
 * text/uri-list o como HTML con <img src>; se prefiere la imagen a la página.
 */
export function extractUrl(data: { getData(type: string): string }): string | null {
  const html = data.getData("text/html");
  const img = html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];
  if (img && URL_RE.test(img)) return img;
  const uriList = data
    .getData("text/uri-list")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#"));
  return urlFromText(uriList) ?? urlFromText(data.getData("text/plain"));
}

const MEDIA_FILE = /\.(jpe?g|png|webp|gif|mp4|mov|webm|mkv|m4v)$/i;

export function isMediaFile(name: string): boolean {
  return MEDIA_FILE.test(name);
}

/** Campo de texto con foco: Ctrl+V y las teclas deben ir al campo, no a la galería. */
export function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest("input, textarea, select, [contenteditable='true']");
}

/** Candidato bajo el cursor (para soltar un archivo sobre una descarga fallida). */
export function candidateAt(x: number, y: number): number | undefined {
  const el = document.elementFromPoint?.(x, y);
  const target = el?.closest<HTMLElement>("[data-candidate-drop]");
  return target ? Number(target.dataset.candidateDrop) : undefined;
}

// Enlaces que se bajan con yt-dlp (igual que en el núcleo).
const VIDEO_SITES = ["youtube.com", "youtu.be", "tiktok.com", "instagram.com", "facebook.com", "x.com",
  "twitter.com", "vimeo.com"];

export function isVideoSite(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return VIDEO_SITES.some((s) => host === s || host.endsWith(`.${s}`));
  } catch {
    return false;
  }
}

/** "1:23" → 83, "45" → 45, "1:02:03" → 3723; vacío → null; inválido → NaN. */
export function parseClock(value: string): number | null {
  const v = value.trim();
  if (!v) return null;
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(v)) return Number.NaN;
  return v.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}
