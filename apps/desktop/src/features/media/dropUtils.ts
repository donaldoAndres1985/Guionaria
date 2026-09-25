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
