import re
import unicodedata

MAX_SLUG = 40


def slugify(text: str, max_length: int = MAX_SLUG) -> str:
    """Minúsculas, sin tildes, palabras unidas por guiones (sección 9 de SPEC.md)."""
    normalized = unicodedata.normalize("NFKD", text)
    ascii_text = "".join(c for c in normalized if not unicodedata.combining(c))
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")
    if len(slug) > max_length:
        cut = slug[:max_length]
        # Cortar en el último guion para no dejar palabras a medias.
        slug = cut.rsplit("-", 1)[0] if "-" in cut else cut
    return slug or "sin-titulo"
