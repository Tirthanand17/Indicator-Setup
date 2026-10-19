"""Application bootstrap; no automatic broker execution or trading available."""
from .server import build_app
app=build_app()
