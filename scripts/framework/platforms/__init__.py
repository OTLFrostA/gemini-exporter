"""Built-in plugin composition. Register additional plugins here or via --plugin."""
from importlib import import_module
from .core import PlatformPlugins, RunConfig, Tier2Runner


def load_plugins(modules=()):
    from .gemini import GeminiPlugin
    from .chatgpt import ChatGPTPlugin
    registry = PlatformPlugins()
    registry.register(GeminiPlugin())
    registry.register(ChatGPTPlugin())
    for module in modules:
        # Explicit opt-in Python modules export register(registry).
        import_module(module).register(registry)
    return registry
