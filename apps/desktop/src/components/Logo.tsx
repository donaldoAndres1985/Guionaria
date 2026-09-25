import { cn } from "@/lib/utils";

/** Marca de Guionaria: hoja de guion (líneas) + botón de reproducir. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <rect x="7" y="9" width="10" height="2.4" rx="1.2" fill="var(--accent-fg)" />
      <rect x="7" y="14.8" width="7" height="2.4" rx="1.2" fill="var(--accent-fg)" />
      <rect x="7" y="20.6" width="10" height="2.4" rx="1.2" fill="var(--accent-fg)" />
      <path d="M19.5 10.5v11l8-5.5z" fill="var(--accent-fg)" />
    </svg>
  );
}
