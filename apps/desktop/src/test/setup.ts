// jsdom no calcula el layout. ProseMirror lo usa al llevar la vista a la selección (scrollIntoView),
// así que se simulan medidas vacías para que los tests del editor no fallen por el entorno.
const emptyRect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  toJSON: () => ({}),
} as DOMRect;

const emptyList = Object.assign([], { item: () => null }) as unknown as DOMRectList;

if (typeof Range !== "undefined") {
  Range.prototype.getClientRects = () => emptyList;
  Range.prototype.getBoundingClientRect = () => emptyRect;
}
if (typeof document !== "undefined" && !document.elementFromPoint) {
  document.elementFromPoint = () => null;
}
