from comfy_api.latest import ComfyExtension, io

from .nodes import SodaPromptLibrary
from .routes import register_routes

WEB_DIRECTORY = "./web"


class SodaPromptLibraryExtension(ComfyExtension):
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [SodaPromptLibrary]


async def comfy_entrypoint() -> SodaPromptLibraryExtension:
    register_routes()
    return SodaPromptLibraryExtension()
