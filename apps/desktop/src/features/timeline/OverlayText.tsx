import type { PreviewOverlay, TextOverlayStyle } from "@/lib/api";
import { overlayBoxCss, overlayLines, overlayLook, overlayTextCss } from "./overlayMeta";

/** Un texto de una pista propia, en su posición, con su formato y su animación. */
export function OverlayTextView({
  text,
  style,
  local,
  duration,
  width,
  height,
  scale,
  testId = "overlay-text",
}: {
  text: string;
  style: TextOverlayStyle;
  /** Segundos desde que empieza el texto. */
  local: number;
  duration: number;
  /** Cuadro del proyecto (px) y escala a la pantalla. */
  width: number;
  height: number;
  scale: number;
  testId?: string;
}) {
  const plain = overlayLines(text, style, width).join("\n");
  const look = overlayLook(style, local, duration, plain.length, width, height);
  const shown = look.chars === null ? plain : plain.slice(0, look.chars);
  const hidden = look.chars === null ? "" : plain.slice(look.chars);
  return (
    <div data-testid={testId} className="pointer-events-none" style={overlayBoxCss(style, look, scale)}>
      <span style={overlayTextCss(style, scale)}>
        {shown}
        {hidden && <span style={{ opacity: 0 }}>{hidden}</span>}
      </span>
    </div>
  );
}

/** Los textos de las pistas propias que se ven en el instante `time` (los de arriba, encima). */
export function OverlayTexts({
  overlays,
  time,
  width,
  height,
  scale,
}: {
  overlays: PreviewOverlay[];
  time: number;
  width: number;
  height: number;
  scale: number;
}) {
  const active = overlays
    .filter((o) => time >= o.start_s && time < o.start_s + o.duration_s)
    .sort((a, b) => a.layer - b.layer);
  return (
    <>
      {active.map((o, i) => (
        <div key={`${o.start_s}-${o.layer}-${i}`} className="pointer-events-none absolute inset-0" style={{ zIndex: 5 + o.layer }}>
          <OverlayTextView
            text={o.text}
            style={o.style}
            local={time - o.start_s}
            duration={o.duration_s}
            width={width}
            height={height}
            scale={scale}
          />
        </div>
      ))}
    </>
  );
}
