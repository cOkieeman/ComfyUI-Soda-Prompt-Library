import importlib
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

ROOT = Path(__file__).resolve().parents[1]
package = types.ModuleType("soda_http_tested")
package.__path__ = [str(ROOT)]
sys.modules[package.__name__] = package
Library = importlib.import_module("soda_http_tested.library").Library
create_handlers = importlib.import_module("soda_http_tested.routes").create_handlers


class RouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "library").mkdir()
        (self.root / "previews").mkdir()
        (self.root / "config.json").write_text('{"aaalice_db":""}', encoding="utf-8")
        self.image = b"test image response bytes"
        (self.root / "previews/a.webp").write_bytes(self.image)
        self.data = {
            "schema": 1,
            "family": "daily",
            "label": "Daily",
            "entries": [
                {"id": "a", "text": "  exact text\n", "preview": "a.webp", "scene": "garden"},
                {"id": "b", "text": "second", "scene": "room"},
            ],
        }
        self.path = self.root / "library/daily.json"
        self.path.write_text(json.dumps(self.data), encoding="utf-8")
        app = web.Application()
        for method, path, handler in create_handlers(Library(self.root, self.root / "user")):
            app.router.add_route(method, path, handler)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()
        self.addAsyncCleanup(self.client.close)

    async def test_filters_detail_and_invalid_requests(self):
        response = await self.client.get("/soda_prompt_library/index?scene=garden&scene=room")
        result = await response.json()
        self.assertEqual(result["total"], 2)
        self.assertNotIn("text", result["entries"][0])
        response = await self.client.get("/soda_prompt_library/entry?key=local:a")
        self.assertEqual((await response.json())["text"], "  exact text\n")
        for query in ("kind=unknown", "page=oops"):
            response = await self.client.get("/soda_prompt_library/index?" + query)
            self.assertEqual(response.status, 400)
        response = await self.client.get("/soda_prompt_library/entry?key=missing")
        self.assertEqual(response.status, 404)

    async def test_preview_and_path_isolation(self):
        response = await self.client.get("/soda_prompt_library/preview?key=local:a")
        self.assertEqual(response.status, 200)
        self.assertEqual(response.headers["Content-Type"], "image/webp")
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(await response.read(), self.image)
        for key in ("local:b", "../../config.json"):
            response = await self.client.get("/soda_prompt_library/preview", params={"key": key})
            self.assertEqual(response.status, 404)

    async def test_category_branch_query_over_http(self):
        self.data["label"] = "Daily/Garden"
        self.path.write_text(json.dumps(self.data), encoding="utf-8")
        await self.client.post("/soda_prompt_library/reload")
        response = await self.client.get(
            "/soda_prompt_library/index?category=Daily&category=Other&category_mode=branch"
        )
        result = await response.json()
        self.assertEqual(result["total"], 2)
        self.assertTrue(result["category_tree"])
        response = await self.client.get("/soda_prompt_library/index?category=Daily")
        self.assertEqual((await response.json())["total"], 0)

    async def test_reload_returns_latest_library_without_mutating_old_response(self):
        response = await self.client.get("/soda_prompt_library/entry?key=local:a")
        old = await response.json()
        self.data["entries"][0]["text"] = "updated source"
        self.path.write_text(json.dumps(self.data), encoding="utf-8")
        response = await self.client.post("/soda_prompt_library/reload")
        self.assertTrue((await response.json())["ok"])
        response = await self.client.get("/soda_prompt_library/entry?key=local:a")
        self.assertEqual((await response.json())["text"], "updated source")
        self.assertEqual(old["text"], "  exact text\n")


if __name__ == "__main__":
    unittest.main()
