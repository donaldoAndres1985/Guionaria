from guionaria_core.domain.states import ProjectStatus as S
from guionaria_core.domain.states import can_transition
from guionaria_core.util.slug import slugify


def test_slugify_removes_accents_and_symbols():
    assert (
        slugify("El secuestro más largo de Ciudad de México")
        == "el-secuestro-mas-largo-de-ciudad-de"
    )
    assert slugify("Priscila Loera Franco foto") == "priscila-loera-franco-foto"
    assert slugify("¡¿Qué pasó?!") == "que-paso"


def test_slugify_limits_length_on_word_boundary():
    slug = slugify("palabra " * 20)
    assert len(slug) <= 40
    assert not slug.endswith("-")
    assert slug.split("-")[-1] == "palabra"


def test_slugify_empty_falls_back():
    assert slugify("¿?") == "sin-titulo"


def test_transitions_forward_one_step_only():
    assert can_transition(S.IDEA, S.GUION_BORRADOR)
    assert not can_transition(S.IDEA, S.GUION_APROBADO)


def test_transitions_backward_allowed():
    assert can_transition(S.ESCENAS_APROBADAS, S.GUION_BORRADOR)
    assert not can_transition(S.IDEA, S.IDEA)
