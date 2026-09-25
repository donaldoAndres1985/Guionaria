Convierte este guion aprobado del canal "{canal}" en escenas para un {formato} ({relacion}).

Reglas:
- Cada segmento tiene una o más escenas; usa el seg_key del segmento. Ninguna escena dura más de {max_escena_s} s: si un segmento dura más, divídelo en varias escenas.
- Cubre TODOS los segmentos, en orden.
- tipo:
  - "real": solo material específico del caso (fotos de personas, lugares exactos, noticias, documentos).
  - "video" o "imagen": planos genéricos de banco de stock.
  - "texto": pantalla con texto (fechas, cifras, citas).
  - "negro": pantalla en negro (pausas dramáticas).
- busqueda_en: obligatoria si tipo es video o imagen. En inglés, 2 a 4 palabras, genérica, pensando en bancos de stock (ej.: "mexico city aerial").
- busqueda_alt: una segunda búsqueda en inglés por si la primera no da resultados.
- busqueda_real: obligatoria si tipo es real. En el idioma del caso, pensada para buscar material real (ej.: "Priscila Loera Franco foto").
- descripcion_visual: qué debe verse, con movimiento de cámara si aplica.
- efecto: uno de {lista_efectos}.
- texto_pantalla: solo si la escena muestra texto; si no, vacío.
- sfx: efecto de sonido si aporta (ej.: static glitch, cinematic impact, typewriter, whoosh); si no, vacío.
- musica: solo cuando cambia la música o su intensidad; si no, vacío.
- Los tiempos NO los generes: los calcula la app.

Estilo del canal: {estilo}

Guion (seg_key · sección · texto):
{guion}
