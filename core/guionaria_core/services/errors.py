class DomainError(Exception):
    """Error de negocio con mensaje para el usuario; la API lo traduce a HTTP."""

    status_code = 400

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class NotFound(DomainError):
    status_code = 404


class Conflict(DomainError):
    status_code = 409
