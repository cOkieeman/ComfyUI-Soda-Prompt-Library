import asyncio
from pathlib import Path

from aiohttp import web

from .library import FILTERS, Library

PREFIX = "/soda_prompt_library"
_registered = False


def create_handlers(library):
    async def index(request):
        params = dict(request.query)
        for name in ("category", *FILTERS):
            params[name] = request.query.getall(name, [])
        try:
            return web.json_response(await asyncio.to_thread(library.query, params))
        except ValueError as exc:
            raise web.HTTPBadRequest(text=str(exc)) from exc

    async def entry(request):
        try:
            return web.json_response(
                await asyncio.to_thread(library.entry, request.query.get("key", ""))
            )
        except KeyError as exc:
            raise web.HTTPNotFound(text="来源条目不存在；已保存正文仍然可用") from exc

    async def preview(request):
        try:
            path, mime = await asyncio.to_thread(library.image, request.query.get("key", ""))
            return web.FileResponse(
                path,
                headers={
                    "Content-Type": mime,
                    "Cache-Control": "no-cache",
                    "X-Content-Type-Options": "nosniff",
                },
            )
        except (KeyError, OSError) as exc:
            raise web.HTTPNotFound() from exc

    async def reload_library(request):
        await asyncio.to_thread(library.refresh, True)
        return web.json_response(
            {"ok": True, "sources": library.sources, "warnings": library.warnings}
        )

    return [
        ("GET", PREFIX + "/index", index),
        ("GET", PREFIX + "/entry", entry),
        ("GET", PREFIX + "/preview", preview),
        ("POST", PREFIX + "/reload", reload_library),
    ]


def register_routes():
    import folder_paths
    from server import PromptServer

    global _registered
    if _registered:
        return
    library = Library(Path(__file__).parent, folder_paths.get_user_directory())
    for method, path, handler in create_handlers(library):
        PromptServer.instance.routes.route(method, path)(handler)
    _registered = True
