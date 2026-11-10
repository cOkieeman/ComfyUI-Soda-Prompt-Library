"""Read-only library adapters. No ComfyUI or third-party imports."""

import copy
import hashlib
import json
import random
import re
import sqlite3
import threading
import time
from collections import Counter
from contextlib import closing
from dataclasses import dataclass, field
from pathlib import Path

KINDS = ("character", "outfit", "content")
FILTERS = ("family", "undress", "intensity", "scene", "camera", "focal")
MODEL_FAMILIES = ("anima", "krea2", "moss", "qwen")
MODEL_STATUSES = ("verified", "untested", "not_recommended")
IMAGE_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def model_info(value):
    """Explicit lineage/validation metadata, never inferred from prompt syntax or filename."""
    if not isinstance(value, dict):
        return {}
    return {k: v for k, v in value.items() if k in MODEL_FAMILIES and v in MODEL_STATUSES}


def matches_model(entry, target, show_other=False):
    if not target or show_other:
        return True
    status = entry.metadata.get("models", {}).get(target, "untested")
    return status == "verified" if entry.kind == "content" else status != "not_recommended"


def contained_image(root, name):
    root = Path(root).resolve()
    path = (root / name).resolve()
    if not path.is_relative_to(root) or path.suffix.lower() not in IMAGE_TYPES:
        raise ValueError("预览路径必须位于配置的图片目录内")
    return path


def usage_from_row(row):
    """Optional display metadata; never appended to or parsed from prompt text."""
    explicit = row.get("usage")
    explicit = explicit if isinstance(explicit, dict) else {}
    result = {}
    for key, fallback in (
        ("note", row.get("nl")),
        ("preview_conditions", None),
        ("tested_with", None),
        ("preview_triggers", row.get("required_style_triggers")),
    ):
        value = explicit.get(key, fallback)
        if isinstance(value, str) and value.strip():
            result[key] = value
    for key, fallback in (
        ("preview_loras", row.get("recommended_loras")),
        ("required_loras", row.get("required_loras")),
    ):
        rows = explicit.get(key, fallback)
        if not isinstance(rows, list):
            continue
        items = []
        for item in rows:
            if not isinstance(item, dict) or not isinstance(item.get("file"), str):
                continue
            value = {"file": item["file"]}
            strength = item.get("strength")
            if type(strength) in (int, float) and float("-inf") < strength < float("inf"):
                value["strength"] = strength
            trigger = item.get("trigger")
            if isinstance(trigger, str) and trigger.strip():
                value["trigger"] = trigger
            items.append(value)
        if items:
            result[key] = items
    return result


@dataclass
class Entry:
    source: str
    id: str
    kind: str
    title: str
    text: str
    category: str
    version: str = ""
    metadata: dict = field(default_factory=dict)
    preview: Path | None = None
    preview_root: Path | None = None
    search: str = field(init=False)

    def __post_init__(self):
        self.search = " ".join(
            [
                self.id,
                self.title,
                self.category,
                self.text,
                str(self.metadata.get("nl") or ""),
                str(self.metadata.get("scene") or ""),
            ]
        ).casefold()

    @property
    def key(self):
        return f"{self.source}:{self.id}"

    def public(self, detail=False):
        result = {
            k: getattr(self, k) for k in ("source", "id", "kind", "title", "category", "version")
        }
        result.update(
            key=self.key,
            metadata={k: v for k, v in self.metadata.items() if k in FILTERS},
            has_preview=self.preview is not None,
            has_outfit=bool(self.metadata.get("has_outfit")),
            models=dict(self.metadata.get("models", {})),
        )
        if detail:
            result["text"] = self.text
            if self.metadata.get("usage"):
                result["usage"] = copy.deepcopy(self.metadata["usage"])
            if self.metadata.get("preview_model"):
                result["preview_model"] = self.metadata["preview_model"]
        return result


class Library:
    def __init__(self, root, user_directory):
        self.root = Path(root)
        self.user_directory = Path(user_directory)
        self.entries = {}
        self.warnings = []
        self.sources = []
        self.revision = ""
        self._signature = None
        self._checked = 0.0
        self._lock = threading.RLock()
        self._catalog = {}
        self._source_models = {}

    def config(self):
        config = {
            "aaalice_db": str(
                self.user_directory / "aaalice/prompt-library/prompt-library.sqlite3"
            ),
            "aaalice_categories": {"角色": "character", "服饰": "outfit"},
            "neons_sources": [],
            "json_sources": [
                {
                    "id": "local",
                    "label": "本地内容库",
                    "directory": str(self.root / "library"),
                    "preview_directory": str(self.root / "previews"),
                }
            ],
        }
        path = self.root / "config.json"
        if path.exists():
            data = read_json(path)
            if not isinstance(data, dict):
                raise ValueError("config.json 必须是对象")
            config.update(data)
        for key, required in (("json_sources", "directory"), ("neons_sources", "file")):
            sources = config.get(key)
            if not isinstance(sources, list):
                raise ValueError(f"{key} 必须是数组")
            for source in sources:
                if not isinstance(source, dict) or not all(
                    isinstance(source.get(name), str) and source[name] for name in ("id", required)
                ):
                    raise ValueError(f"{key} 的数据源必须包含非空 id 和 {required}")
                if key == "neons_sources" and not isinstance(source.get("families", {}), dict):
                    raise ValueError("Neons families 必须是对象")
        if not isinstance(config.get("aaalice_categories"), dict):
            raise ValueError("aaalice_categories 必须是对象")
        return config

    def warn(self, text):
        if len(self.warnings) < 100:
            self.warnings.append(text)

    def signature(self, config):
        paths = [self.root / "config.json"]
        if config.get("display_catalog"):
            paths.append(Path(config["display_catalog"]))
        if config.get("aaalice_db"):
            db = str(config["aaalice_db"])
            paths.extend(Path(p) for p in (db, db + "-wal"))
        for source in config.get("json_sources", []):
            paths.extend(sorted(Path(source["directory"]).glob("*.json")))
        for source in config.get("neons_sources", []):
            paths.append(Path(source["file"]))
            if source.get("manifest"):
                paths.append(Path(source["manifest"]))
        values = []
        for path in paths:
            try:
                stat = path.stat()
                values.append((str(path), stat.st_mtime_ns, stat.st_size))
            except FileNotFoundError:
                values.append((str(path), None, None))
        return tuple(values)

    def refresh(self, force=False):
        with self._lock:
            if not force and time.monotonic() - self._checked < 2:
                return
            self._checked = time.monotonic()
            try:
                config = self.config()
                signature = self.signature(config)
            except (OSError, ValueError, KeyError, TypeError) as exc:
                self.warnings = [f"配置读取失败，保留上次索引：{exc}"]
                return
            if not force and signature == self._signature:
                return
            self.entries, self.warnings, self.sources = {}, [], []
            self._catalog = {}
            if config.get("display_catalog"):
                try:
                    catalog = read_json(config["display_catalog"])
                    if (
                        not isinstance(catalog, dict)
                        or catalog.get("version") != 1
                        or not isinstance(catalog.get("entries"), dict)
                    ):
                        raise ValueError("显示目录必须是 version 1，包含 entries 对象")
                    self._catalog = catalog["entries"]
                except (OSError, ValueError, TypeError) as exc:
                    self.warn(f"显示目录不可用，保留原始名称和正文：{exc}")
            self._source_models = {
                s["id"]: model_info(s.get("models"))
                for s in config.get("json_sources", []) + config.get("neons_sources", [])
            }
            jobs = (
                [("aaalice", "Aaalice", lambda: self.load_aaalice(config))]
                if config.get("aaalice_db")
                else []
            )
            jobs += [
                (s["id"], s.get("label", s["id"]), lambda s=s: self.load_json(s))
                for s in config.get("json_sources", [])
            ]
            jobs += [
                (s["id"], s.get("label", s["id"]), lambda s=s: self.load_neons(s))
                for s in config.get("neons_sources", [])
            ]
            seen = set()
            for source_id, label, load in jobs:
                if not re.fullmatch(r"[a-zA-Z0-9_-]+", source_id) or source_id in seen:
                    self.warn(f"重复或无效的数据源 ID：{source_id}")
                    continue
                seen.add(source_id)
                before = len(self.entries)
                try:
                    load()
                    status = "ready"
                except (OSError, ValueError, sqlite3.Error, KeyError, TypeError) as exc:
                    status = "unavailable"
                    self.warn(f"{label}：{exc}")
                self.sources.append(
                    dict(
                        id=source_id,
                        label=label,
                        status=status,
                        count=len(self.entries) - before,
                        models=self._source_models.get(source_id, {}),
                        kinds=sorted(
                            {e.kind for e in self.entries.values() if e.source == source_id}
                        ),
                    )
                )
            self._signature = signature
            self.revision = hashlib.sha256(repr(signature).encode()).hexdigest()[:16]

    def add(self, entry):
        if entry.key in self.entries:
            self.warn(f"重复条目，保留先加载项：{entry.key}")
            return
        overlay = self._catalog.get(entry.key, {})
        if not isinstance(overlay, dict):
            overlay = {}
        original_title, original_category = entry.title, entry.category
        for name in ("title", "category"):
            value = overlay.get(name)
            if isinstance(value, str) and value.strip():
                setattr(entry, name, value)
        entry.metadata["models"] = model_info(
            overlay.get(
                "models", entry.metadata.get("models", self._source_models.get(entry.source, {}))
            )
        )
        preview_model = overlay.get("preview_model", entry.metadata.get("preview_model"))
        if isinstance(preview_model, str) and preview_model.strip():
            entry.metadata["preview_model"] = preview_model
        entry.__post_init__()
        entry.search += " " + original_title.casefold() + " " + original_category.casefold()
        self.entries[entry.key] = entry

    def load_aaalice(self, config):
        path = Path(config["aaalice_db"]).resolve()
        with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as db:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA query_only=ON")
            categories = {
                r["id"]: dict(r) for r in db.execute("SELECT id,name,parent_id FROM categories")
            }
            mapping = config["aaalice_categories"]
            labels = {}
            for key in categories:
                names, visited, current = [], set(), key
                while current in categories and current not in visited:
                    visited.add(current)
                    names.insert(0, categories[current]["name"])
                    current = categories[current]["parent_id"]
                labels[key] = (mapping.get(names[0]) if names else None, "/".join(names))
            root = path.parent / "assets"
            for row in db.execute(
                "SELECT e.id,e.title,e.text,e.category_id,e.updated_at,e.preview_hash,a.extension FROM entries e LEFT JOIN assets a ON e.preview_hash=a.hash ORDER BY e.position,e.title,e.id"
            ):
                kind, category = labels.get(row["category_id"], (None, ""))
                if kind not in KINDS:
                    continue
                preview = None
                if row["preview_hash"] and row["extension"]:
                    try:
                        preview = contained_image(root, f"{row['preview_hash']}.{row['extension']}")
                    except ValueError as exc:
                        self.warn(f"Aaalice {row['id']}：{exc}")
                self.add(
                    Entry(
                        "aaalice",
                        row["id"],
                        kind,
                        row["title"],
                        row["text"],
                        category,
                        row["updated_at"],
                        preview=preview,
                        preview_root=root,
                    )
                )

    def load_json(self, source):
        directory = Path(source["directory"])
        if not directory.is_dir():
            raise FileNotFoundError("库目录不存在，可配置已有目录或添加本地 JSON")
        preview_root = Path(source.get("preview_directory", directory / "previews"))
        for path in sorted(directory.glob("*.json")):
            try:
                data = read_json(path)
                if (
                    not isinstance(data, dict)
                    or type(data.get("schema")) is not int
                    or data["schema"] != 1
                ):
                    raise ValueError("只支持 schema 1")
                family, label, rows = data["family"], data["label"], data["entries"]
                if (
                    not isinstance(family, str)
                    or not isinstance(label, str)
                    or not isinstance(rows, list)
                ):
                    raise ValueError("family、label 或 entries 类型不正确")
            except (OSError, ValueError, KeyError, TypeError) as exc:
                self.warn(f"跳过 {path.name}：{exc}")
                continue
            for index, row in enumerate(rows):
                try:
                    if not isinstance(row, dict):
                        raise ValueError("条目必须是对象")
                    entry_id = row["id"]
                    if not isinstance(entry_id, str) or not re.fullmatch(r"[a-z0-9_]+", entry_id):
                        raise ValueError("无效 ID")
                    # Generic libraries may supply exact text; original schema keeps subject + tags.
                    text = row.get("text")
                    if text is None:
                        subject, tags = row["subject"], row["tags"]
                        if (
                            not isinstance(subject, str)
                            or not subject.strip()
                            or not isinstance(tags, str)
                        ):
                            raise ValueError("subject 和 tags 必须是文本，subject 不可为空")
                        text = subject + ", " + tags
                    if not isinstance(text, str):
                        raise ValueError("正文必须是文本")
                    kind = source.get("kind", "content")
                    if kind not in KINDS:
                        raise ValueError("无效素材类型")
                    preview = None
                    if row.get("preview"):
                        try:
                            preview = contained_image(preview_root, row["preview"])
                        except (ValueError, TypeError) as exc:
                            self.warn(f"{entry_id} 预览不可用：{exc}")
                    metadata = {k: row.get(k) for k in (*FILTERS, "nl")}
                    metadata["has_outfit"] = bool(row.get("outfit"))
                    metadata["usage"] = usage_from_row(row)
                    if "models" in row or "models" in data:
                        metadata["models"] = model_info(row.get("models", data.get("models")))
                    metadata["preview_model"] = row.get(
                        "preview_model", data.get("preview_model", source.get("preview_model"))
                    )
                    metadata["family"] = family
                    title = row.get("title", entry_id)
                    if not isinstance(title, str):
                        raise ValueError("title 必须是文本")
                    self.add(
                        Entry(
                            source["id"],
                            entry_id,
                            kind,
                            title,
                            text,
                            label,
                            str(row.get("ver", 1)),
                            metadata,
                            preview,
                            preview_root,
                        )
                    )
                except (ValueError, KeyError, TypeError) as exc:
                    self.warn(f"跳过 {path.name} 第 {index + 1} 条：{exc}")

    def load_neons(self, source):
        rows = read_json(source["file"])
        rows = rows.get("styles", []) if isinstance(rows, dict) else rows
        if not isinstance(rows, list):
            raise ValueError("Neons 文件必须是条目数组")
        mapping = source.get("families", {})
        manifest = {}
        if source.get("manifest"):
            try:
                manifest = read_json(source["manifest"])
                if not isinstance(manifest, dict):
                    raise ValueError("预览索引必须是对象")
            except (OSError, ValueError, TypeError) as exc:
                self.warn(f"Neons 预览索引不可用，保留提示词：{exc}")
                manifest = {}
        root = Path(source.get("preview_directory", Path(source["file"]).parent / "previews"))
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get("family"), str):
                self.warn("跳过 family 类型不正确的 Neons 条目")
                continue
            if mapping.get(row["family"]) not in KINDS:
                continue
            entry_id = row.get("id")
            if not isinstance(entry_id, str) or not entry_id:
                self.warn("跳过缺少稳定 ID 的 Neons 条目")
                continue
            mode = source.get("text_field", "tags")
            if mode == "tags":
                tags = row.get("tags", [])
                if not isinstance(tags, list) or not all(isinstance(tag, str) for tag in tags):
                    self.warn(f"{entry_id} 的 tags 不是字符串列表")
                    continue
                text = ", ".join(tags)
            else:
                text = row.get("nl", "")
            if not isinstance(text, str):
                self.warn(f"{entry_id} 的原文不是文本")
                continue
            preview = None
            asset = manifest.get(re.sub(r"[^A-Za-z0-9]+", "_", entry_id).strip("_")[:140], {})
            if not isinstance(asset, dict):
                self.warn(f"{entry_id} 的预览记录不是对象，保留提示词")
                asset = {}
            cover = asset.get("cover")
            if cover:
                try:
                    preview = contained_image(root, cover)
                except (OSError, ValueError, TypeError) as exc:
                    self.warn(f"{entry_id}：{exc}")
            self.add(
                Entry(
                    source["id"],
                    entry_id,
                    mapping[row["family"]],
                    str(row.get("name", entry_id)),
                    text,
                    row["family"],
                    metadata={},
                    preview=preview,
                    preview_root=root,
                )
            )

    def query(self, params):
        with self._lock:
            self.refresh()
            kind = params.get("kind", "content")
            if kind not in KINDS:
                raise ValueError("未知素材类型")
            target = params.get("target_model", "")
            if target and target not in MODEL_FAMILIES:
                raise ValueError("未知模型系列")
            pool = [e for e in self.entries.values() if e.kind == kind]
            pool = [e for e in pool if matches_model(e, target, params.get("model_scope") == "all")]
            if params.get("source"):
                pool = [e for e in pool if e.source == params["source"]]
            facets = {"category": dict(Counter(e.category for e in pool))}
            for field_name in FILTERS:
                facets[field_name] = dict(
                    Counter(
                        str(e.metadata[field_name])
                        for e in pool
                        if e.metadata.get(field_name) is not None
                    )
                )
            terms = params.get("q", "").casefold().split()

            def matches(e):
                if params.get("source") and e.source != params["source"]:
                    return False
                if not all(term in e.search for term in terms):
                    return False
                for name in ("category", *FILTERS):
                    wanted = params.get(name, [])
                    actual = e.category if name == "category" else str(e.metadata.get(name, ""))
                    if name == "category" and params.get("category_mode") == "branch":
                        if wanted and not any(
                            actual == path or actual.startswith(path + "/") for path in wanted
                        ):
                            return False
                        continue
                    if wanted and actual not in wanted:
                        return False
                return True

            found = [e for e in pool if matches(e)]
            if params.get("random"):
                return random.choice(found).public(True) if found else None
            page = max(1, int(params.get("page", 1)))
            limit = 60
            page = min(page, max(1, (len(found) + limit - 1) // limit))
            return {
                "entries": [e.public() for e in found[(page - 1) * limit : page * limit]],
                "total": len(found),
                "page": page,
                "page_size": limit,
                "facets": facets,
                "category_tree": True,
                "model_filtering": True,
                "sources": self.sources,
                "warnings": self.warnings,
                "revision": self.revision,
            }

    def entry(self, key):
        with self._lock:
            self.refresh()
            return self.entries[key].public(True)

    def image(self, key):
        with self._lock:
            self.refresh()
            entry = self.entries[key]
            if not entry.preview or not entry.preview_root:
                raise FileNotFoundError(key)
            # Re-check after indexing in case a directory link was changed.
            path = entry.preview.resolve()
            if not path.is_relative_to(entry.preview_root.resolve()) or not path.is_file():
                raise FileNotFoundError(key)
            return path, IMAGE_TYPES[path.suffix.lower()]
