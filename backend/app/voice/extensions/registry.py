"""Extension registry.

The seam for adding capabilities without editing the engine. An extension
declares an id and a `setup(ctx)` that wires whatever it contributes — extra
audio post-processing, export formats, routes, preset providers. The registry
holds the list; the engine and core never special-case a feature.

Adding a feature = new module under `extensions/<feature>/` that calls
`register(...)`, plus one import in `extensions/__init__.py`. Removing it =
delete the folder and the import. The core does not change.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Protocol


class ExtensionContext(Protocol):
    """What an extension is handed at setup time.

    Kept minimal and additive. `engine` is the live TTSEngine; `register_*`
    hooks let an extension contribute behavior. New hook types can be added
    here without breaking existing extensions.
    """

    engine: object  # TTSEngine (typed loosely to avoid an import cycle)

    def add_audio_postprocessor(
        self, fn: "Callable[[object], object]"
    ) -> None: ...

    def add_export_format(
        self, name: str, fn: "Callable[..., bytes]"
    ) -> None: ...


@dataclass
class Extension:
    """One registered feature."""

    id: str
    setup: Callable[[ExtensionContext], None]
    description: str = ""
    dispose: Callable[[], None] | None = None


_registry: "dict[str, Extension]" = {}


def register(ext: Extension) -> None:
    if ext.id in _registry:
        raise ValueError(f"Duplicate extension id: {ext.id}")
    _registry[ext.id] = ext


def all_extensions() -> list[Extension]:
    return list(_registry.values())


def activate_all(ctx: ExtensionContext) -> list[str]:
    """Run every registered extension's setup. Returns the activated ids."""
    activated: list[str] = []
    for ext in _registry.values():
        ext.setup(ctx)
        activated.append(ext.id)
    return activated


def clear() -> None:
    """Drop all registrations (mainly for tests)."""
    for ext in list(_registry.values()):
        if ext.dispose:
            ext.dispose()
    _registry.clear()
