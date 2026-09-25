import { cn } from "@/lib/utils";

// Tonos cálidos y fríos que se leen bien sobre el fondo oscuro.
const TONES = ["#ff7a1a", "#e2b04a", "#6fbf8e", "#5aa6d6", "#b58be0", "#e0708a"];

export function ChannelAvatar({
  name,
  id,
  className,
}: {
  name: string;
  id: number;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-md text-[13px] font-semibold text-[#1a0f08]",
        className,
      )}
      style={{ background: TONES[id % TONES.length] }}
    >
      {initials || "?"}
    </span>
  );
}
