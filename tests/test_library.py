import importlib.util
import json
import sqlite3
import sys
import tempfile
import time
import unittest
from contextlib import closing
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("soda_library_tested", ROOT / "library.py")
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
Library = module.Library


class LibraryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.data = self.root / "data"
        self.data.mkdir()
        self.config = {
            "aaalice_db": "",
            "json_sources": [
                {
                    "id": "local",
                    "label": "测试",
                    "directory": str(self.data),
                    "preview_directory": str(self.root / "images"),
                }
            ],
            "neons_sources": [],
        }
        self.write_config()
        self.lib = Library(self.root, self.root / "user")

    def write_config(self):
        (self.root / "config.json").write_text(json.dumps(self.config), encoding="utf-8")

    def write(self, rows, name="a.json", **fields):
        data = {"schema": 1, "family": "garden", "label": "庭院", "entries": rows, **fields}
        (self.data / name).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    def row(self, id="a", **fields):
        return {
            "id": id,
            "subject": "adult, solo",
            "tags": " garden,  sunlight, ",
            "preview": None,
            **fields,
        }

    def test_original_text_preserved_and_schema_composition(self):
        self.write([self.row(), self.row("b", text=" \nquality, eyes, shirt,, \n ")])
        self.assertEqual(self.lib.entry("local:a")["text"], "adult, solo,  garden,  sunlight, ")
        self.assertEqual(self.lib.entry("local:b")["text"], " \nquality, eyes, shirt,, \n ")

    def test_bad_file_bad_row_duplicate_and_version_isolation(self):
        self.write([self.row(), {}, self.row()])
        self.write([self.row("b")], "b.json", schema=2)
        (self.data / "c.json").write_text("{", encoding="utf-8")
        result = self.lib.query({})
        self.assertEqual(result["total"], 1)
        self.assertEqual(len(result["warnings"]), 4)

    def test_pagination_search_filters_and_full_pool_random(self):
        self.write(
            [
                self.row(
                    f"entry_{n}",
                    scene="garden" if n % 2 else "street",
                    intensity=1 if n < 100 else 2,
                )
                for n in range(125)
            ]
        )
        self.assertEqual(len(self.lib.query({})["entries"]), 60)
        self.assertEqual(len(self.lib.query({"page": "3"})["entries"]), 5)
        result = self.lib.query({"scene": ["garden"], "intensity": ["2"]})
        self.assertEqual(result["total"], 12)
        # Filter matches an entry outside page one; random must not use only rendered cards.
        found = self.lib.query({"q": "entry_124", "random": "1"})
        self.assertEqual(found["id"], "entry_124")
        self.assertIsNone(self.lib.query({"q": "missing", "random": "1"}))

    def test_hot_reload_file_edit_and_deletion(self):
        self.write([self.row()])
        old = self.lib.entry("local:a")
        self.write([self.row(text="updated longer text")])
        self.lib._checked = 0
        self.assertEqual(self.lib.entry("local:a")["text"], "updated longer text")
        self.assertNotEqual(old["text"], self.lib.entry("local:a")["text"])
        (self.data / "a.json").unlink()
        self.lib.refresh(True)
        self.assertEqual(self.lib.query({})["total"], 0)
        self.assertTrue(old["text"])

    def test_preview_escape_is_blocked_without_dropping_text(self):
        self.write([self.row(preview="../outside.png")])
        self.assertEqual(self.lib.query({})["total"], 1)
        self.assertFalse(self.lib.entry("local:a")["has_preview"])
        with self.assertRaises(FileNotFoundError):
            self.lib.image("local:a")

    def test_preview_served_only_by_known_id(self):
        images = self.root / "images"
        images.mkdir()
        (images / "a.webp").write_bytes(b"fixture")
        self.write([self.row(preview="a.webp")])
        self.assertEqual(self.lib.image("local:a")[0], images / "a.webp")
        with self.assertRaises(KeyError):
            self.lib.image("../../secret")

    def test_namespace_and_duplicate_source(self):
        self.write([self.row()])
        self.config["json_sources"] += [
            {**self.config["json_sources"][0], "id": "other"},
            self.config["json_sources"][0],
        ]
        self.write_config()
        self.assertEqual(self.lib.query({})["total"], 2)
        self.assertTrue(any("数据源 ID" in w for w in self.lib.warnings))

    def test_unavailable_source_does_not_hide_other_sources(self):
        self.config["aaalice_db"] = str(self.root / "missing.sqlite3")
        self.write_config()
        self.write([self.row()])
        self.assertEqual(self.lib.query({})["total"], 1)
        self.assertFalse((self.root / "missing.sqlite3").exists())

    def test_aaalice_nested_categories_assets_and_no_writes(self):
        path = self.root / "prompt-library.sqlite3"
        with closing(sqlite3.connect(path)) as db:
            db.executescript("""
                CREATE TABLE categories(id TEXT,name TEXT,parent_id TEXT);
                INSERT INTO categories VALUES('c','角色',NULL),('work','作品','c'),('o','服饰',NULL),('s','画风',NULL);
                CREATE TABLE entries(id TEXT,title TEXT,text TEXT,category_id TEXT,updated_at TEXT,preview_hash TEXT,position INT);
                INSERT INTO entries VALUES('a','Alice','exact character','work','1','abc',0),('b','coat','coat','o','1',NULL,1),('s','style','style','s','1',NULL,2);
                CREATE TABLE assets(hash TEXT,extension TEXT);
                INSERT INTO assets VALUES('abc','webp');
            """)
        before = path.read_bytes()
        self.config["aaalice_db"] = str(path)
        self.write_config()
        result = self.lib.query({"kind": "character"})
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["entries"][0]["category"], "角色/作品")
        self.assertEqual(self.lib.query({"kind": "outfit"})["total"], 1)
        self.assertEqual(path.read_bytes(), before)

    def test_neons_requires_explicit_family_mapping(self):
        path = self.root / "custom.json"
        path.write_text(
            json.dumps(
                [
                    {"id": "a", "name": "Name", "family": "People", "tags": ["first", "second"]},
                    {"id": "b", "family": "Style", "tags": ["paint"]},
                ]
            ),
            encoding="utf-8",
        )
        self.config["neons_sources"] = [
            {"id": "neons", "file": str(path), "families": {"People": "character"}}
        ]
        self.write_config()
        self.assertEqual(self.lib.query({"kind": "character"})["total"], 1)
        self.assertEqual(self.lib.entry("neons:a")["text"], "first, second")

    def test_1200_entries_page_response_is_bounded(self):
        self.write([self.row(f"item_{n}") for n in range(1200)])
        start = time.perf_counter()
        result = self.lib.query({})
        self.assertEqual(result["total"], 1200)
        self.assertEqual(len(result["entries"]), 60)
        self.assertNotIn("text", result["entries"][0])
        self.assertLess(time.perf_counter() - start, 1.5)

    def test_malformed_config_preserves_previous_index(self):
        self.write([self.row()])
        self.assertEqual(self.lib.query({})["total"], 1)
        for sources in (
            None,
            [None],
            [{"directory": str(self.data)}],
            [{"id": 5, "directory": str(self.data)}],
        ):
            self.config["json_sources"] = sources
            self.write_config()
            self.lib.refresh(True)
            self.assertEqual(self.lib.query({})["total"], 1)
            self.assertIn("保留上次索引", self.lib.warnings[0])


if __name__ == "__main__":
    unittest.main()
