from typing import Any

class _Completions:
    def create(self, **kwargs: Any) -> Any: ...

class _Chat:
    completions: _Completions

class OpenAI:
    chat: _Chat

    def __init__(
        self,
        *,
        base_url: str | None = None,
        api_key: str | None = None,
    ) -> None: ...
