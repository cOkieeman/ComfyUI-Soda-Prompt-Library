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

    def test_usage_is_detail_only_and_does_not_change_prompt_or_cached_data(self):
        exact = "  original,,\n"
        self.write(
            [
                self.row(
                    text=exact,
                    nl="本地预览说明",
                    recommended_loras=[{"file": "style/example.safetensors", "strength": 0.4}],
                    usage={
                        "required_loras": [{"file": "tool/camera.safetensors", "strength": -0.6}],
                        "tested_with": "当前模型两种子",
                    },
                )
            ]
        )
        self.assertNotIn("usage", self.lib.query({})["entries"][0])
        detail = self.lib.entry("local:a")
        self.assertEqual(detail["text"], exact)
        self.assertEqual(detail["usage"]["note"], "本地预览说明")
        self.assertEqual(detail["usage"]["preview_loras"][0]["strength"], 0.4)
        detail["usage"]["required_loras"][0]["strength"] = 8
        self.assertEqual(self.lib.entry("local:a")["usage"]["required_loras"][0]["strength"], -0.6)

    def test_bad_optional_usage_does_not_reject_valid_entry(self):
        self.write([self.row(usage="bad", nl=["bad"], recommended_loras=[None, {}, 2])])
        detail = self.lib.entry("local:a")
        self.assertNotIn("usage", detail)
        self.assertEqual(self.lib.query({})["warnings"], [])

    def test_models_inherit_source_but_explicit_row_metadata_takes_precedence(self):
        self.config["json_sources"][0]["models"] = {"anima": "verified"}
        self.write_config()
        self.write(
            [self.row(), self.row("b", models={"krea2": "verified"}), self.row("c", models={})]
        )
        self.assertEqual(self.lib.entry("local:a")["models"], {"anima": "verified"})
        self.assertEqual(self.lib.entry("local:b")["models"], {"krea2": "verified"})
        self.assertEqual(self.lib.entry("local:c")["models"], {})

    def test_content_model_filtering_applies_to_facets_pagination_and_random(self):
        self.write(
            [
                self.row(f"entry_{n}", models={"anima" if n % 2 else "krea2": "verified"})
                for n in range(125)
            ]
        )
        result = self.lib.query({"target_model": "anima"})
        self.assertEqual(result["total"], 62)
        self.assertEqual(sum(result["facets"]["category"].values()), 62)
        self.assertEqual(len(self.lib.query({"target_model": "anima", "page": "2"})["entries"]), 2)
        self.assertEqual(
            self.lib.query({"target_model": "anima", "model_scope": "all"})["total"], 125
        )
        self.assertIsNone(self.lib.query({"target_model": "moss", "random": "1"}))
        with self.assertRaises(ValueError):
            self.lib.query({"target_model": "made_up"})

    def test_role_tags_are_not_assumed_anima_only_and_untested_is_not_incompatible(self):
        self.config["json_sources"][0]["kind"] = "character"
        self.write_config()
        self.write(
            [
                self.row(models={"anima": "verified", "krea2": "verified"}),
                self.row("b"),
                self.row("c", models={"krea2": "not_recommended"}),
            ]
        )
        result = self.lib.query({"kind": "character", "target_model": "krea2"})
        self.assertEqual({e["id"] for e in result["entries"]}, {"a", "b"})
        self.assertEqual(
            self.lib.query({"kind": "character", "target_model": "krea2", "model_scope": "all"})[
                "total"
            ],
            3,
        )

    def test_display_overlay_is_searchable_hot_reloadable_and_cannot_rewrite_body(self):
        catalog = self.root / "display.json"
        self.config["display_catalog"] = str(catalog)
        self.write_config()
        self.write([self.row(title="original title")])

        def save(title):
            catalog.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "entries": {
                            "local:a": {
                                "title": title,
                                "category": "服饰主题/裙装",
                                "text": "FORBIDDEN",
                                "models": {"moss": "verified"},
                                "preview_model": "MOSS preview",
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )

        save("中文服饰")
        detail = self.lib.entry("local:a")
        self.assertEqual(detail["text"], "adult, solo,  garden,  sunlight, ")
        self.assertEqual(detail["category"], "服饰主题/裙装")
        self.assertEqual(detail["preview_model"], "MOSS preview")
        self.assertEqual(self.lib.query({"q": "中文服饰", "target_model": "moss"})["total"], 1)
        self.assertEqual(self.lib.query({"q": "original title"})["total"], 1)
        save("新版中文名称")
        self.lib._checked = 0
        self.assertEqual(self.lib.entry("local:a")["title"], "新版中文名称")

    def test_bad_optional_models_do_not_reject_original_prompt(self):
        self.write([self.row(models={"anima": [], "unknown": "verified", "moss": "guessed"})])
        self.assertEqual(self.lib.entry("local:a")["models"], {})
        self.assertEqual(self.lib.query({})["warnings"], [])

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

    def test_category_branches_include_children_not_similar_names(self):
        for i, label in enumerate(("Series", "Series/A", "Series/A/Child", "SeriesTwo", "Other")):
            self.write([self.row(f"item_{i}", scene="garden")], f"{i}.json", label=label)
        exact = self.lib.query({"category": ["Series"]})
        self.assertEqual(exact["total"], 1)
        params = {"category": ["Series", "Other"], "category_mode": "branch"}
        result = self.lib.query(params)
        self.assertTrue(result["category_tree"])
        self.assertEqual(result["total"], 4)
        self.assertEqual(self.lib.query({**params, "scene": ["missing"]})["total"], 0)
        self.assertIn(
            self.lib.query({**params, "random": "1"})["category"],
            {"Series", "Series/A", "Series/A/Child", "Other"},
        )

    def test_category_facets_follow_selected_source(self):
        self.write([self.row()])
        self.config["json_sources"].append({**self.config["json_sources"][0], "id": "other"})
        self.write_config()
        self.assertEqual(self.lib.query({})["facets"]["category"]["庭院"], 2)
        result = self.lib.query({"source": "other"})
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["facets"]["category"]["庭院"], 1)

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

    def test_neons_bad_preview_metadata_keeps_text_and_other_sources(self):
        self.write([self.row()])
        path = self.root / "neons.json"
        manifest = self.root / "manifest.json"
        path.write_text(
            json.dumps(
                [
                    {"id": "a", "family": "People", "tags": ["original"]},
                    {"id": "b", "family": "People", "tags": ["second"]},
                ]
            ),
            encoding="utf-8",
        )
        self.config["neons_sources"] = [
            {
                "id": "neons",
                "file": str(path),
                "families": {"People": "character"},
                "manifest": str(manifest),
            }
        ]
        self.write_config()
        for value in ([], {"a": None}, {"a": {"cover": 123}}, {"a": {"cover": "../escape.png"}}):
            with self.subTest(manifest=value):
                manifest.write_text(json.dumps(value), encoding="utf-8")
                self.lib.refresh(True)
                self.assertEqual(self.lib.query({"kind": "character"})["total"], 2)
                self.assertEqual(self.lib.entry("neons:a")["text"], "original")
                self.assertEqual(self.lib.query({})["total"], 1)
        manifest.write_text("{", encoding="utf-8")
        self.lib.refresh(True)
        self.assertEqual(self.lib.query({"kind": "character"})["total"], 2)

    def test_neons_bad_row_does_not_drop_later_rows(self):
        path = self.root / "neons.json"
        path.write_text(
            json.dumps(
                [
                    {"id": "broken", "family": [], "tags": []},
                    {"id": "valid", "family": "People", "tags": ["original"]},
                ]
            ),
            encoding="utf-8",
        )
        self.config["neons_sources"] = [
            {"id": "neons", "file": str(path), "families": {"People": "character"}}
        ]
        self.write_config()
        self.assertEqual(self.lib.query({"kind": "character"})["total"], 1)

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
