"""Cliente HTTP compartido. Los tests reemplazan `client_factory` por uno con MockTransport."""

from collections.abc import Callable

import httpx

USER_AGENT = (
    "Guionaria/0.1 (app de escritorio local; https://github.com/donaldoAndres1985/Guionaria)"
)


def _default_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=httpx.Timeout(20.0, connect=10.0),
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT},
    )


client_factory: Callable[[], httpx.AsyncClient] = _default_client


def http_client() -> httpx.AsyncClient:
    return client_factory()
