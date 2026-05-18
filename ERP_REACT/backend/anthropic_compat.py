"""Anthropic SDK compatibility layer.

Strip automatiquement les parametres deprecies par certains modeles Claude,
pour eviter les erreurs 400 "X is deprecated for this model".

Cas connus (au 2026-05-17):
- `temperature` est deprecie sur Claude Opus 4.7 (extended thinking implicite
  force temperature=1.0). L'API retourne:
    400 'temperature is deprecated for this model.'

Le module monkey-patch `anthropic.resources.messages.Messages.create/stream`
au moment de l'import. Idempotent et thread-safe (Python GIL).

USAGE: importer une seule fois au boot de l'application
(`from . import anthropic_compat`). Tous les clients Anthropic crees
APRES seront automatiquement patches.
"""

import logging

logger = logging.getLogger(__name__)

# Prefixes de modeles qui deprecient le parametre `temperature`.
# A maj si Anthropic etend la liste a d'autres modeles.
TEMPERATURE_DEPRECATED_PREFIXES = ("claude-opus-4-7",)


def _strip_unsupported_kwargs(kwargs: dict) -> dict:
    """Filtre les kwargs deprecies pour le modele specifie.

    Mutate kwargs in-place et retourne aussi par convenience. Si `temperature`
    est passe pour un modele qui ne le supporte plus, on le retire silencieusement
    et on log un info uniquement si la valeur etait != defaults connus (0.1, 1.0).
    """
    model = kwargs.get("model", "")
    if not model:
        return kwargs
    if any(model.startswith(p) for p in TEMPERATURE_DEPRECATED_PREFIXES):
        if "temperature" in kwargs:
            t = kwargs.pop("temperature")
            if t not in (0.1, 1.0):
                logger.info(
                    "anthropic_compat: temperature=%s strippe (deprecated par %s)",
                    t, model,
                )
    return kwargs


def _patch_method(cls, method_name: str):
    """Wrap une methode de classe Anthropic pour strip auto kwargs deprecies."""
    if not hasattr(cls, method_name):
        return
    original = getattr(cls, method_name)
    if getattr(original, "_anthropic_compat_patched", False):
        return  # Already patched

    def _wrapped(self, *args, **kwargs):
        _strip_unsupported_kwargs(kwargs)
        return original(self, *args, **kwargs)

    _wrapped._anthropic_compat_patched = True
    _wrapped.__name__ = original.__name__
    _wrapped.__doc__ = original.__doc__
    setattr(cls, method_name, _wrapped)


def patch_anthropic():
    """Apply monkey-patch to anthropic SDK classes.

    Idempotent: ne patche qu'une fois meme si appele plusieurs fois.
    Defensif: en cas d'echec d'import du SDK ou de changement de structure,
    log un warning sans crash.
    """
    try:
        import anthropic  # noqa: F401
    except ImportError:
        logger.debug("anthropic SDK non disponible — patch ignore")
        return

    try:
        from anthropic.resources.messages import Messages
        _patch_method(Messages, "create")
        _patch_method(Messages, "stream")
    except Exception as exc:
        logger.warning("anthropic_compat: patch Messages failed: %s", exc)

    # Patch beta.Messages si disponible (Files API beta, etc.)
    try:
        from anthropic.resources.beta.messages import Messages as BetaMessages
        _patch_method(BetaMessages, "create")
        _patch_method(BetaMessages, "stream")
    except Exception as exc:
        # beta.Messages peut ne pas exister sur certaines versions SDK — non-fatal
        logger.debug("anthropic_compat: patch BetaMessages skipped: %s", exc)

    logger.info(
        "anthropic_compat: monkey-patch applique (prefixes deprecies temperature: %s)",
        TEMPERATURE_DEPRECATED_PREFIXES,
    )


# Apply patch immediately on module import.
patch_anthropic()
