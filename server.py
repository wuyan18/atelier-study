#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
大二资料阅读器 — 本地只读 Web 服务（P2）
- 仅监听 127.0.0.1，默认端口 8765，被占用时依次尝试 8766..8775
- 资料根目录只读；运行数据写入 %LOCALAPPDATA%\\course-reader\\
- 依赖：Python 3.10+ 标准库（无第三方依赖）；可选 pdftotext（全文索引）
"""
import argparse
import datetime as _dt
import email.utils
import html
import json
import logging
import mimetypes
import os
import re
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

APP_NAME = "course-reader"
APP_VERSION = "P2.2"

# ---------------------------------------------------------------------------
# 路径配置
# ---------------------------------------------------------------------------
PROJ_DIR = os.path.dirname(os.path.abspath(__file__))


def _resolve_data_root():
    """资料根目录，按优先级解析：

    1. 命令行 `--data-root`
    2. 环境变量 `COURSE_READER_DATA_ROOT`
    3. 项目内 `data/library-root.txt` 的第一行有效路径（本地私有，不入库）
    4. `~/Documents/课程资料` 兜底
    """
    env = os.environ.get("COURSE_READER_DATA_ROOT")
    if env:
        return env
    local = os.path.join(PROJ_DIR, "data", "library-root.txt")
    try:
        with open(local, "r", encoding="utf-8-sig") as fh:
            for line in fh:
                line = line.strip()
                if line and not line.startswith("#"):
                    return line
    except OSError:
        pass
    return os.path.join(os.path.expanduser("~"), "Documents", "课程资料")


DEFAULT_DATA_ROOT = _resolve_data_root()
DATA_ROOT = DEFAULT_DATA_ROOT
STATE_DIR = os.environ.get(
    "COURSE_READER_STATE_DIR",
    os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~/.local/share")), APP_NAME),
)
STATE_FILE = os.path.join(STATE_DIR, "state.json")
LOG_DIR = os.path.join(STATE_DIR, "logs")
RUNTIME_FILE = os.path.join(STATE_DIR, "runtime.json")

# 扫描时忽略的临时/系统文件
IGNORE_PATTERNS = [re.compile(p) for p in (r"^~\$", r"^desktop\.ini$", r"\.tmp$", r"^\.DS_Store$")]

MIME_MAP = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".bcmap": "application/octet-stream",
}

# ---------------------------------------------------------------------------
# 日志
# ---------------------------------------------------------------------------
def setup_logging():
    os.makedirs(LOG_DIR, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    root.addHandler(sh)
    try:
        from logging.handlers import RotatingFileHandler
        fh = RotatingFileHandler(
            os.path.join(LOG_DIR, "server.log"), maxBytes=1024 * 1024, backupCount=3, encoding="utf-8")
        fh.setFormatter(fmt)
        root.addHandler(fh)
    except OSError:
        pass  # 日志目录不可写时不阻断服务


LOG = logging.getLogger("course-reader")

# ---------------------------------------------------------------------------
# 状态存储（读写均在 LOCALAPPDATA，原子替换）
# ---------------------------------------------------------------------------
class StateStore:
    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        self.data = {"version": 1, "progress": {}, "completed": {}, "settings": {}}
        self.load()

    def load(self):
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                merged = {"version": 1, "progress": {}, "completed": {}, "settings": {}}
                merged.update({k: v for k, v in data.items() if k in merged})
                self.data = merged
        except FileNotFoundError:
            pass
        except (OSError, ValueError) as e:
            LOG.warning("state.json 读取失败（将重建）: %s", e)

    def save(self, data=None):
        with self.lock:
            if data is not None:
                self.data = data
            tmp = self.path + ".tmp"
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.data, f, ensure_ascii=False, indent=1)
            os.replace(tmp, self.path)

    def get(self):
        with self.lock:
            return json.loads(json.dumps(self.data))  # deep copy 快照


STATE = StateStore(STATE_FILE)


# ---------------------------------------------------------------------------
# P2.1：考试计划数据（功能集成自本机 exam_planning 项目，原项目零改动）
# 数据文件随项目走：<项目目录>\data\exams.json（可用环境变量覆盖，测试用临时文件）
# 保存策略沿用原项目：先备份 .bak，再临时文件 + os.replace 原子替换
# ---------------------------------------------------------------------------
EXAMS_FILE = os.environ.get(
    "COURSE_READER_EXAMS_FILE", os.path.join(PROJ_DIR, "data", "exams.json"))
EXAM_TIME_RE = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?"
    r"(?:\.(\d{1,6}))?(Z|[+-]\d{2}:?\d{2})?$"
)
EXAM_DEFAULT_DURATION = 120


def exam_time_to_epoch(value):
    """examTime 字符串 → 本地毫秒时间戳；非法返回 None（与前端 exams-core.js 同规则）"""
    if not isinstance(value, str):
        return None
    m = EXAM_TIME_RE.match(value.strip())
    if not m:
        return None
    year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
    hour, minute = int(m.group(4)), int(m.group(5))
    second = int(m.group(6) or 0)
    frac = (m.group(7) or "").ljust(6, "0")[:6]
    micro = int(frac or 0)
    zone = m.group(8) or ""
    tzinfo = None
    if zone == "Z":
        tzinfo = _dt.timezone.utc
    elif zone:
        raw = zone[1:].replace(":", "")
        hh, mm = int(raw[0:2]), int(raw[2:4])
        if hh > 14 or mm > 59:
            return None
        offset = _dt.timedelta(minutes=hh * 60 + mm)
        tzinfo = _dt.timezone(-offset if zone[0] == "-" else offset)
    try:
        dt = _dt.datetime(year, month, day, hour, minute, second, micro, tzinfo=tzinfo)
    except ValueError:
        return None
    return int(dt.timestamp() * 1000)


def epoch_to_local_iso(ts):
    """毫秒时间戳 → 本地 YYYY-MM-DDTHH:mm:ss（存储用，无时区后缀）"""
    return _dt.datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%dT%H:%M:%S")


def _exam_number(value, allow_bool=False):
    if isinstance(value, bool) and not allow_bool:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value
    return None


def validate_exams(raw):
    """校验考试数据（规则与原项目 app.py 一致），返回 (errors, items)"""
    errors, items = [], []
    if not isinstance(raw, list):
        return ["顶层数据必须是一个数组。"], []
    for i, item in enumerate(raw, 1):
        if not isinstance(item, dict):
            errors.append(f"第 {i} 条考试数据不是一个有效的对象。")
            continue
        ok = True
        subject = item.get("subject")
        if not isinstance(subject, str) or not subject.strip():
            errors.append(f"第 {i} 条考试数据中的 subject 必须是字符串且不能为空。")
            ok = False
        raw_time = item.get("examTime")
        if isinstance(raw_time, (int, float)) and not isinstance(raw_time, bool):
            ts = int(raw_time)              # 已规范化的毫秒时间戳，直接接受
        else:
            ts = exam_time_to_epoch(raw_time)
        if ts is None:
            errors.append(f"第 {i} 条考试数据中的 examTime 不是有效的日期格式。")
            ok = False
        credit = _exam_number(item.get("credit"))
        if credit is None:
            errors.append(f"第 {i} 条考试数据中的 credit 必须是数字。")
            ok = False
        focus = item.get("focus")
        if not isinstance(focus, str):
            errors.append(f"第 {i} 条考试数据中的 focus 必须是字符串。")
            ok = False
        duration = item.get("duration")
        dur_value = EXAM_DEFAULT_DURATION
        if duration is not None:
            num = _exam_number(duration)
            if num is None or num <= 0:
                errors.append(
                    f"第 {i} 条考试数据中的 duration 必须是大于 0 的数字（分钟）。")
                ok = False
            else:
                dur_value = int(round(num))
        if not ok:
            continue
        eid = item.get("id")
        items.append({
            "id": eid if isinstance(eid, str) and eid else f"exam-{ts}-{i}",
            "subject": subject.strip(),
            "examTime": epoch_to_local_iso(ts),
            "credit": int(credit) if float(credit).is_integer() else round(float(credit), 2),
            "focus": focus,
            "duration": dur_value,
        })
    return errors, items


class ExamStore:
    """考试计划数据文件读写（考试数据独立于 state.json，互不影响）"""

    def __init__(self, path):
        self.path = path
        self.backup = path + ".bak"
        self.lock = threading.Lock()

    def load(self):
        """→ (state, data, detail)；state: ok | missing | corrupt"""
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            return "missing", [], ""
        except (OSError, ValueError) as e:
            LOG.warning("exams.json 读取失败: %s", e)
            return "corrupt", [], str(e)
        if not isinstance(data, list):
            return "corrupt", [], "数据文件损坏（顶层不是数组）"
        return "ok", data, ""

    def save(self, items):
        with self.lock:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(items, f, ensure_ascii=False, indent=2)
                f.write("\n")
            try:
                if os.path.isfile(self.path):
                    with open(self.path, "rb") as src, open(self.backup, "wb") as dst:
                        dst.write(src.read())
            except OSError as e:            # 备份失败不阻塞保存
                LOG.warning("考试数据备份失败: %s", e)
            os.replace(tmp, self.path)

    def clear(self):
        with self.lock:
            for path in (self.path, self.backup):
                try:
                    os.remove(path)
                except FileNotFoundError:
                    pass


EXAMS = ExamStore(EXAMS_FILE)


def exams_export_dir():
    """导出目录：当前用户「文档」下的 Atelier Study 文件夹（不存在则创建）"""
    home = os.environ.get("USERPROFILE") or os.path.expanduser("~")
    folder = os.path.join(home, "Documents", "Atelier Study")
    os.makedirs(folder, exist_ok=True)
    return folder

# ---------------------------------------------------------------------------
# P2：全文索引（pdftotext 逐页抽取 + 增量缓存）
# 缓存目录 %LOCALAPPDATA%\course-reader\cache\，可整体删除重建
# ---------------------------------------------------------------------------
import hashlib
import shutil as _shutil

def find_pdftotext():
    cands = [
        os.environ.get("COURSE_READER_PDFTOTEXT"),
        r"C:\texlive\2026\bin\windows\pdftotext.exe",
        r"C:\texlive\2025\bin\windows\pdftotext.exe",
        _shutil.which("pdftotext"),
    ]
    for c in cands:
        if c and os.path.isfile(c):
            return c
    return None


class Indexer:
    """对有文字层的 PDF 建立逐页文本索引；扫描件标记 scanned 不做假索引。"""

    def __init__(self, data_root, cache_dir):
        self.data_root = data_root
        self.cache_dir = cache_dir
        self.manifest_file = os.path.join(cache_dir, "manifest.json")
        self.lock = threading.RLock()
        self.pdftotext = find_pdftotext()
        self.status = {
            "state": "idle",            # idle | building | ready | error
            "pdftotext": bool(self.pdftotext),
            "indexed": 0, "total": 0, "pages": 0,
            "scanned": [],              # 无文字层（扫描件）文件 rel
            "failed": [],               # 提取失败文件 rel
            "changed": [],              # 本次增量更新重新抽取的文件
            "durationMs": None, "lastBuild": None,
            "message": "",
        }
        self._manifest = None

    # ---- manifest（rel -> {size,mtime_ns,pages,status,file}） ----
    def manifest(self):
        if self._manifest is None:
            try:
                with open(self.manifest_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self._manifest = data if isinstance(data, dict) else {}
            except (OSError, ValueError):
                self._manifest = {}
        return self._manifest

    def _save_manifest(self):
        os.makedirs(self.cache_dir, exist_ok=True)
        tmp = self.manifest_file + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self._manifest, f, ensure_ascii=False, indent=1)
        os.replace(tmp, self.manifest_file)

    def pdf_list(self):
        out = []
        for root, dirs, files in os.walk(self.data_root):
            dirs[:] = [d for d in dirs if not d.startswith(".dsh-office-")]
            for name in files:
                if not name.lower().endswith(".pdf"):
                    continue
                if any(p.search(name) for p in IGNORE_PATTERNS):
                    continue
                full = os.path.join(root, name)
                rel = os.path.relpath(full, self.data_root).replace("\\", "/")
                try:
                    st = os.stat(full)
                    out.append((rel, full, st.st_size, st.st_mtime_ns))
                except OSError:
                    pass
        return out

    def _cache_file(self, rel, size, mtime_ns):
        h = hashlib.sha1(f"{rel}|{size}|{mtime_ns}".encode("utf-8")).hexdigest()[:16]
        return os.path.join(self.cache_dir, f"pdf-{h}.json")

    def _extract(self, full):
        """返回 (pages: list[str], status: 'ok'|'scanned'|'failed')"""
        if not self.pdftotext:
            return [], "failed"
        try:
            r = subprocess.run(
                [self.pdftotext, "-enc", "UTF-8", full, "-"],
                capture_output=True, timeout=180,
            )
        except subprocess.TimeoutExpired:
            LOG.warning("pdftotext 超时: %s", full)
            return [], "failed"
        except OSError as e:
            LOG.warning("pdftotext 启动失败: %s: %s", full, e)
            return [], "failed"
        if r.returncode != 0:
            LOG.warning("pdftotext 返回 %s: %s", r.returncode, full)
            return [], "failed"
        txt = r.stdout.decode("utf-8", "replace")
        pages = txt.split("\x0c")
        if pages and not pages[-1].strip():
            pages.pop()
        nonws = sum(len(p.strip()) for p in pages)
        if nonws == 0:
            return pages, "scanned"  # 无文字层（扫描件）——不做假索引
        return pages, "ok"

    def refresh(self, force=False):
        """增量更新索引。返回本次重新抽取的文件列表。"""
        with self.lock:
            if self.status["state"] == "building":
                return None  # 已在进行
            self.status["state"] = "building"
            self.status["changed"] = []
        t0 = time.time()
        try:
            m = dict(self.manifest())
            pdfs = self.pdf_list()
            total = len(pdfs)
            changed = []
            for i, (rel, full, size, mtime_ns) in enumerate(pdfs):
                self.status["indexed"] = i
                self.status["total"] = total
                entry = m.get(rel)
                if not force and entry and entry.get("size") == size and entry.get("mtime_ns") == mtime_ns:
                    continue  # 缓存命中，跳过
                pages, st = self._extract(full)
                if st == "ok":
                    cf = self._cache_file(rel, size, mtime_ns)
                    os.makedirs(self.cache_dir, exist_ok=True)
                    tmp = cf + ".tmp"
                    with open(tmp, "w", encoding="utf-8") as f:
                        json.dump({"pages": pages}, f, ensure_ascii=False)
                    os.replace(tmp, cf)
                    m[rel] = {"size": size, "mtime_ns": mtime_ns, "pages": len(pages),
                              "status": "ok", "file": os.path.basename(cf)}
                else:
                    m[rel] = {"size": size, "mtime_ns": mtime_ns, "pages": 0,
                              "status": st, "file": None}
                changed.append(rel)
            # 清理已消失文件
            alive = {rel for rel, _, _, _ in pdfs}
            for rel in [r for r in m if r not in alive]:
                del m[rel]
            self._manifest = m
            self._save_manifest()
            scanned = sorted(r for r, e in m.items() if e["status"] == "scanned")
            failed = sorted(r for r, e in m.items() if e["status"] == "failed")
            pages = sum(e["pages"] for e in m.values())
            dt = int((time.time() - t0) * 1000)
            self.status.update({
                "state": "ready", "indexed": total, "total": total,
                "pages": pages, "scanned": scanned, "failed": failed,
                "changed": changed, "durationMs": dt,
                "lastBuild": _dt.datetime.now().isoformat(timespec="seconds"),
                "message": "",
            })
            LOG.info("索引完成: %d PDF, %d 页, 增量 %d, 耗时 %dms (scanned=%d failed=%d)",
                     total, pages, len(changed), dt, len(scanned), len(failed))
            return changed
        except Exception as e:  # noqa: BLE001
            self.status["state"] = "error"
            self.status["message"] = str(e)
            LOG.exception("索引构建失败")
            return None

    def _load_pages(self, rel):
        e = self.manifest().get(rel)
        if not e or e.get("status") != "ok" or not e.get("file"):
            return None
        cf = os.path.join(self.cache_dir, e["file"])
        try:
            with open(cf, "r", encoding="utf-8") as f:
                return json.load(f).get("pages")
        except (OSError, ValueError):
            return None

    def search(self, q, max_hits_per_file=50, snippet_pad=40):
        """逐页不区分大小写匹配。返回按文件分组的结果。"""
        q = (q or "").strip()
        if not q:
            return []
        qf = q.casefold()
        m = self.manifest()
        results = []
        for rel in sorted(m):
            e = m[rel]
            if e.get("status") != "ok":
                continue
            pages = self._load_pages(rel)
            if not pages:
                continue
            hits = []
            for pi, text in enumerate(pages, 1):
                tf = text.casefold()
                start = 0
                while len(hits) < max_hits_per_file:
                    idx = tf.find(qf, start)
                    if idx < 0:
                        break
                    hits.append({
                        "page": pi,
                        "snippet": _make_snippet(text, idx, len(q), snippet_pad),
                    })
                    start = idx + max(1, len(qf))
                if len(hits) >= max_hits_per_file:
                    break
            if hits:
                results.append({
                    "rel": rel,
                    "course": rel.split("/")[0],
                    "name": rel.rsplit("/", 1)[-1],
                    "totalPages": e.get("pages", 0),
                    "hits": hits,
                })
        return results


def _make_snippet(text, idx, qlen, pad):
    """命中位置前后各 pad 字符，压平空白，截断到完整字符。"""
    s = max(0, idx - pad)
    e = min(len(text), idx + qlen + pad)
    snippet = text[s:e]
    snippet = re.sub(r"\s+", " ", snippet).strip()
    prefix = "…" if s > 0 else ""
    suffix = "…" if e < len(text) else ""
    return prefix + snippet + suffix


INDEX = Indexer(DATA_ROOT, os.path.join(STATE_DIR, "cache"))

# ---------------------------------------------------------------------------
# 路径安全
# ---------------------------------------------------------------------------
_ROOT_REAL = None

def root_real():
    global _ROOT_REAL
    if _ROOT_REAL is None:
        _ROOT_REAL = os.path.realpath(DATA_ROOT)
    return _ROOT_REAL


def resolve_rel(rel):
    """把 URL 里的相对路径解析为 root 内的绝对路径；越界/不存在则抛 ValueError。"""
    if not rel or "\x00" in rel:
        raise ValueError("invalid path")
    rel = rel.replace("\\", "/").strip("/")
    if rel == "":
        raise ValueError("invalid path")
    candidate = os.path.join(root_real(), *rel.split("/"))
    full = os.path.realpath(candidate)
    if full != root_real() and not full.startswith(root_real() + os.sep):
        raise ValueError("path escapes root")
    if not os.path.exists(full):
        raise ValueError("not found")
    return full


def safe_rel_from_query(query, key="path"):
    """从 query string 提取并校验 path，返回 (绝对路径, 相一 rel)。"""
    vals = query.get(key)
    if not vals or not vals[0]:
        raise ValueError("missing path")
    rel = unquote(vals[0])
    full = resolve_rel(rel)
    rel_norm = os.path.relpath(full, root_real()).replace(os.sep, "/")
    return full, rel_norm

# ---------------------------------------------------------------------------
# 目录扫描
# ---------------------------------------------------------------------------
def _ignored(name):
    return any(p.search(name) for p in IGNORE_PATTERNS)


def _size_text(n):
    if n >= 1024 * 1024 * 1024:
        return f"{n / (1024**3):.1f} GB"
    if n >= 1024 * 1024:
        return f"{n / (1024**2):.1f} MB"
    if n >= 1024:
        return f"{n / 1024:.1f} KB"
    return f"{n} B"


def _file_node(full, rel):
    st = os.stat(full)
    name = os.path.basename(full)
    return {
        "type": "file",
        "name": name,
        "rel": rel,
        "ext": os.path.splitext(name)[1].lstrip(".").lower(),
        "size": st.st_size,
        "sizeText": _size_text(st.st_size),
        "mtime": _dt.datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M"),
    }


def _scan_dir(full_dir, rel_dir):
    """递归扫描一个目录，返回 (children, fileCount, sizeBytes)。"""
    children = []
    file_count = 0
    size_bytes = 0
    try:
        entries = sorted(os.listdir(full_dir), key=lambda s: (not s[:2].isdigit(), s))
    except OSError as e:
        LOG.warning("listdir 失败 %s: %s", full_dir, e)
        return children, 0, 0
    subdirs = []
    files = []
    for name in entries:
        if _ignored(name):
            continue
        p = os.path.join(full_dir, name)
        rel = f"{rel_dir}/{name}" if rel_dir else name
        if os.path.isdir(p):
            subdirs.append((name, p, rel))
        else:
            files.append((name, p, rel))
    for name, p, rel in files:
        try:
            node = _file_node(p, rel)
        except OSError:
            continue
        children.append(node)
        file_count += 1
        size_bytes += node["size"]
    for name, p, rel in subdirs:
        node = _scan_dir_node(p, rel)
        children.append(node)
        file_count += node["stats"]["fileCount"]
        size_bytes += node["stats"]["sizeBytes"]
    # 目录在前、文件在后，同级按名称排序
    children.sort(key=lambda c: (c["type"] != "dir", c["name"]))
    return children, file_count, size_bytes


def _scan_dir_node(full_dir, rel_dir):
    children, file_count, size_bytes = _scan_dir(full_dir, rel_dir)
    archive = any(seg.startswith("99-") for seg in rel_dir.split("/"))
    return {
        "type": "dir",
        "name": os.path.basename(full_dir),
        "rel": rel_dir,
        "archive": archive,
        "empty": file_count == 0,
        "children": children,
        "stats": {"fileCount": file_count, "sizeBytes": size_bytes},
    }


def scan_library():
    root_realpath = root_real()
    if not os.path.isdir(root_realpath):
        raise RuntimeError(f"资料根目录不存在: {DATA_ROOT}")
    courses = []
    root_files = []
    total_files = 0
    total_size = 0
    for name in sorted(os.listdir(root_realpath), key=lambda s: (not s[:2].isdigit(), s)):
        if _ignored(name):
            continue
        p = os.path.join(root_realpath, name)
        if os.path.isdir(p):
            node = _scan_dir_node(p, name)
            pdfs = 0
            for _dp, _dn, fns in os.walk(p):
                for f in fns:
                    if not _ignored(f) and f.lower().endswith(".pdf"):
                        pdfs += 1
            node["kind"] = "course"
            node["stats"]["pdfs"] = pdfs
            courses.append(node)
            total_files += node["stats"]["fileCount"]
            total_size += node["stats"]["sizeBytes"]
        else:
            try:
                fn = _file_node(p, name)
            except OSError:
                continue
            root_files.append(fn)
            total_files += 1
            total_size += fn["size"]
    return {
        "root": os.path.basename(root_realpath.rstrip("\\/")),
        "generatedAt": _dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "version": APP_VERSION,
        "stats": {"files": total_files, "sizeBytes": total_size,
                  "sizeText": _size_text(total_size), "courses": len(courses)},
        "courses": courses,
        "rootFiles": root_files,
    }


# 目录树结果缓存：/api/tree 要遍历全部目录并 os.stat 每个文件，
# 文件多时会明显变慢（本机 103 文件约 90–125ms）。缓存序列化后的字节 + ETag：
#   1) TTL 内直接复用，多标签/反复刷新不再重复扫描；
#   2) 带 ETag，浏览器用 If-None-Match 协商命中 304，连 47KB 的 JSON 都不用重传；
#   3) ?fresh=1 强制重扫（前端「重新扫描」按钮用）。
TREE_TTL_SECONDS = 2.0
_TREE_CACHE = {"at": 0.0, "data": None, "body": b"", "etag": '""'}
_TREE_LOCK = threading.Lock()


def scan_library_cached(fresh=False):
    """返回缓存字典 {data, body, etag, ms}；TTL 内命中缓存，fresh=True 立即重扫。"""
    with _TREE_LOCK:
        now = time.time()
        if (not fresh and _TREE_CACHE["data"] is not None
                and (now - _TREE_CACHE["at"]) <= TREE_TTL_SECONDS):
            return dict(_TREE_CACHE, ms=0.0)
        t0 = time.time()
        data = scan_library()
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        # ETag 用去掉 generatedAt 的稳定内容算，否则每次重扫时间戳一变就失效
        stable = {k: v for k, v in data.items() if k != "generatedAt"}
        digest = hashlib.sha1(json.dumps(stable, ensure_ascii=False).encode("utf-8")).hexdigest()
        _TREE_CACHE.update({
            "at": time.time(),
            "data": data,
            "body": body,
            "etag": '"%s"' % digest[:16],
            "ms": (time.time() - t0) * 1000.0,
        })
        return dict(_TREE_CACHE)



# ---------------------------------------------------------------------------
# HTTP Handler
# ---------------------------------------------------------------------------
class QuietServer(ThreadingHTTPServer):
    """浏览器中断连接（下载取消、关页面、/api/shutdown）属正常现象，
    不应该在控制台刷出一大段 ConnectionResetError 堆栈。"""

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, TimeoutError)):
            return
        super().handle_error(request, client_address)


class Handler(BaseHTTPRequestHandler):
    server_version = f"course-reader/{APP_VERSION}"
    protocol_version = "HTTP/1.1"

    # ---- 基础工具 -------------------------------------------------------
    def log_message(self, fmt, *args):
        LOG.info("%s - %s", self.client_address[0], fmt % args)

    def _send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(self, code, message):
        self._send_json({"error": message}, code)

    def _redirect(self, location):
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _read_body_json(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > 5 * 1024 * 1024:
            return None
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            return None

    # ---- 静态文件 -------------------------------------------------------
    def _serve_static(self, rel):
        if rel in ("", "/"):
            rel = "/index.html"
        rel = rel.lstrip("/")
        if rel.startswith("..") or ".." + os.sep in rel or "\x00" in rel:
            self._send_error_json(403, "forbidden")
            return
        full = os.path.join(PROJ_DIR, *rel.split("/"))
        full_real = os.path.realpath(full)
        proj_real = os.path.realpath(PROJ_DIR)
        if full_real != proj_real and not full_real.startswith(proj_real + os.sep):
            self._send_error_json(403, "forbidden")
            return
        if not os.path.isfile(full_real):
            self._send_error_json(404, "not found")
            return
        ext = os.path.splitext(full_real)[1].lower()
        mime = MIME_MAP.get(ext) or mimetypes.guess_type(full_real)[0] or "application/octet-stream"
        try:
            stat = os.stat(full_real)
            etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
        except OSError as e:
            self._send_error_json(500, f"stat error: {e}")
            return
        # 协商缓存：ETag 一致直接 304（文件改动后浏览器自动拉新）
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            return
        try:
            with open(full_real, "rb") as f:
                data = f.read()
        except OSError as e:
            self._send_error_json(500, f"read error: {e}")
            return
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("ETag", etag)
        self.send_header("Last-Modified",
                         email.utils.formatdate(stat.st_mtime, usegmt=True))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    # ---- 文件流（支持 Range，PDF.js 按需读取） --------------------------
    def _serve_file(self, query):
        try:
            full, rel = safe_rel_from_query(query)
        except ValueError as e:
            self._send_error_json(400 if "escape" in str(e) or "invalid" in str(e) else 404, str(e))
            return
        if not os.path.isfile(full):
            self._send_error_json(404, "not a file")
            return
        size = os.path.getsize(full)
        ext = os.path.splitext(full)[1].lower()
        mime = MIME_MAP.get(ext) or "application/octet-stream"
        encoded_name = os.path.basename(full).encode("utf-8")
        range_header = self.headers.get("Range")
        start, end = 0, size - 1
        partial = False
        if range_header:
            m = re.match(r"^bytes=(\d*)-(\d*)$", range_header.strip())
            if m and (m.group(1) or m.group(2)):
                if m.group(1):
                    start = int(m.group(1))
                    end = int(m.group(2)) if m.group(2) else size - 1
                else:  # bytes=-N 后缀形式
                    n = int(m.group(2))
                    start = max(0, size - n)
                    end = size - 1
                if start >= size or start > end:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                end = min(end, size - 1)
                partial = True
        length = end - start + 1
        code = 206 if partial else 200
        self.send_response(code)
        self.send_header("Content-Type", mime)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        self.send_header("Content-Disposition", "inline")
        if partial:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if self.command == "GET":
            try:
                with open(full, "rb") as f:
                    f.seek(start)
                    remaining = length
                    while remaining > 0:
                        chunk = f.read(min(1024 * 1024, remaining))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        remaining -= len(chunk)
            except OSError as e:
                LOG.warning("文件读取中断 %s: %s", full, e)

    # ---- API ------------------------------------------------------------
    def _api_zipinfo(self, query):
        """ZIP 压缩包只读清单（不解压、不写盘）"""
        try:
            full, rel = safe_rel_from_query(query)
        except ValueError as e:
            self._send_error_json(400 if "escape" in str(e) or "invalid" in str(e) else 404, str(e))
            return
        if not os.path.isfile(full):
            self._send_error_json(404, "not a file")
            return
        if os.path.splitext(full)[1].lower() != ".zip":
            self._send_error_json(400, "not a zip file")
            return
        import zipfile
        LIMIT = 500
        entries = []
        total = 0
        try:
            with zipfile.ZipFile(full) as zf:
                infos = zf.infolist()
                total = len(infos)
                for it in infos[:LIMIT]:
                    entries.append({
                        "name": it.filename,
                        "isDir": it.is_dir(),
                        "size": it.file_size,
                        "packed": it.compress_size,
                    })
        except (zipfile.BadZipFile, OSError) as e:
            self._send_error_json(422, f"zip read failed: {e}")
            return
        self._send_json({
            "rel": rel,
            "entries": entries,
            "total": total,
            "truncated": total > LIMIT,
        })

    def _api_text(self, query):
        """文本文件只读预览：默认最多前 200 KB，避免 22MB .in 全量入 DOM"""
        try:
            full, rel = safe_rel_from_query(query)
        except ValueError as e:
            self._send_error_json(400 if "escape" in str(e) or "invalid" in str(e) else 404, str(e))
            return
        if not os.path.isfile(full):
            self._send_error_json(404, "not a file")
            return
        try:
            max_bytes = int(query.get("max", ["204800"])[0])
        except ValueError:
            max_bytes = 204800
        max_bytes = max(1024, min(max_bytes, 4 * 1024 * 1024))
        size = os.path.getsize(full)
        truncated = size > max_bytes
        raw = b""
        try:
            with open(full, "rb") as f:
                raw = f.read(max_bytes + 3)  # 多读几字节用于判断被截断的字符
        except OSError as e:
            self._send_error_json(500, f"read error: {e}")
            return
        text = None
        used_enc = None
        for enc in ("utf-8", "gb18030"):
            try:
                # 只解码到 max_bytes 对齐处，尾部残缺字节丢弃
                text = raw[:max_bytes].decode(enc)
                used_enc = enc
                break
            except UnicodeDecodeError:
                continue
        if text is None:
            text = raw[:max_bytes].decode("utf-8", errors="replace")
            used_enc = "utf-8(replace)"
        # 截断到完整行（避免半行乱码感）
        if truncated and text:
            nl = text.rfind("\n")
            if nl > 0:
                text = text[: nl + 1]
        self._send_json({
            "rel": rel,
            "content": text,
            "size": size,
            "truncated": truncated,
            "encoding": used_enc,
        })

    def _api_search(self, query):
        """P2 全文搜索：q=关键词。索引未就绪时也返回已建成部分+状态。"""
        q = (query.get("q", [""])[0] or "").strip()
        if not q:
            self._send_error_json(400, "missing query parameter: q")
            return
        if not INDEX.pdftotext:
            self._send_json({
                "query": q, "results": [], "index": INDEX.status,
                "message": "未找到 pdftotext（可设 COURSE_READER_PDFTOTEXT 环境变量）",
            })
            return
        try:
            max_hits = int(query.get("maxHits", ["50"])[0])
        except ValueError:
            max_hits = 50
        max_hits = max(1, min(max_hits, 500))
        results = INDEX.search(q, max_hits_per_file=max_hits)
        self._send_json({
            "query": q,
            "results": results,
            "totalFiles": len(results),
            "totalHits": sum(len(r["hits"]) for r in results),
            "index": INDEX.status,
        })

    def _api_tree(self, query):
        fresh = (query.get("fresh") or ["0"])[0].lower() in ("1", "true", "yes")
        try:
            payload = scan_library_cached(fresh=fresh)
        except RuntimeError as e:
            self._send_error_json(500, str(e))
            return
        etag = payload["etag"]
        if not fresh and self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        body = payload["body"]
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("ETag", etag)
        self.send_header("X-Scan-Ms", "%.1f" % payload.get("ms", 0.0))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _api_state(self):
        self._send_json(STATE.get())

    def _api_state_post(self):
        body = self._read_body_json()
        if not isinstance(body, dict):
            self._send_error_json(400, "invalid json body")
            return
        STATE.save(body)
        self._send_json(STATE.get())

    def _api_open(self):
        body = self._read_body_json()
        if not isinstance(body, dict) or "path" not in body:
            self._send_error_json(400, "invalid json body")
            return
        mode = body.get("mode", "open")
        if mode not in ("open", "reveal"):
            self._send_error_json(400, "invalid mode")
            return
        try:
            full, rel = safe_rel_from_query({"path": [body["path"]]})
        except ValueError as e:
            self._send_error_json(400, str(e))
            return
        try:
            if mode == "reveal":
                # explorer /select, 只对文件；目录直接打开文件夹
                if os.path.isfile(full):
                    subprocess.Popen(["explorer", "/select," + full])
                else:
                    subprocess.Popen(["explorer", full])
            else:
                os.startfile(full)  # noqa: S606 路径已校验位于资料根目录内
            LOG.info("system %s: %s", mode, rel)
        except OSError as e:
            self._send_error_json(500, f"os error: {e}")
            return
        self._send_json({"ok": True, "rel": rel, "mode": mode})

    def _api_shutdown(self):
        self._send_json({"ok": True})
        threading.Thread(target=self.server.shutdown, daemon=True).start()

    # ---- 考试计划（P2.1） -----------------------------------------------
    def _api_exams_get(self):
        state, data, detail = EXAMS.load()
        payload = {
            "success": state != "corrupt",
            "state": state,
            "data": data,
            "count": len(data),
            "file": EXAMS_FILE,
            "hasBackup": os.path.isfile(EXAMS.backup),
        }
        if state == "corrupt":
            payload["message"] = "数据文件损坏"
            payload["detail"] = detail
        self._send_json(payload)

    def _api_exams_post(self):
        body = self._read_body_json()
        raw = body.get("exams") if isinstance(body, dict) and "exams" in body else body
        errors, items = validate_exams(raw)
        if errors:
            self._send_json({
                "success": False,
                "message": errors[0] + (f"（共 {len(errors)} 项错误）" if len(errors) > 1 else ""),
                "errors": errors[:10],
            })
            return
        EXAMS.save(items)
        LOG.info("考试数据已保存：%d 场", len(items))
        self._send_json({
            "success": True,
            "message": f"已保存 {len(items)} 场考试",
            "count": len(items),
            "data": items,
        })

    def _api_exams_sample(self):
        """写入示例数据（+3/+7/+12 天各一场），已有数据会被替换"""
        now = _dt.datetime.now()
        rows = []
        for offset, hour, minute, subject, credit, focus in (
            (3, 9, 0, "高等数学", 4, "极限、微分、积分重点复习"),
            (7, 14, 0, "大学英语", 3, "阅读理解和作文模板"),
            (12, 10, 0, "数据结构", 3, "树、图、排序算法"),
        ):
            day = (now + _dt.timedelta(days=offset)).replace(
                hour=hour, minute=minute, second=0, microsecond=0)
            rows.append({
                "subject": subject,
                "examTime": day.strftime("%Y-%m-%dT%H:%M:%S"),
                "credit": credit,
                "focus": focus,
            })
        errors, items = validate_exams(rows)
        if errors:
            self._send_error_json(500, errors[0])
            return
        EXAMS.save(items)
        self._send_json({"success": True, "message": "已加载 3 场示例考试",
                         "count": len(items), "data": items})

    def _api_exams_clear(self):
        EXAMS.clear()
        self._send_json({"success": True, "message": "考试数据已清除"})

    def _api_exams_export(self):
        state, data, _detail = EXAMS.load()
        if state == "missing" or not data:
            self._send_json({"success": False, "message": "还没有考试数据可以导出"})
            return
        errors, items = validate_exams(data)
        if errors:
            self._send_json({"success": False, "message": errors[0]})
            return
        folder = exams_export_dir()
        name = "考试计划-" + _dt.datetime.now().strftime("%Y%m%d-%H%M%S") + ".json"
        target = os.path.join(folder, name)
        try:
            with open(target, "w", encoding="utf-8") as f:
                json.dump(items, f, ensure_ascii=False, indent=2)
                f.write("\n")
        except OSError as e:
            self._send_error_json(500, f"写入失败: {e}")
            return
        LOG.info("考试数据已导出：%s", target)
        self._send_json({"success": True, "path": target, "count": len(items),
                         "message": f"已导出 {len(items)} 场考试"})

    def _api_exams_open_dir(self):
        folder = os.path.dirname(EXAMS_FILE)
        try:
            os.makedirs(folder, exist_ok=True)
            os.startfile(folder)  # noqa: S606 项目数据目录（非资料目录）
        except OSError as e:
            self._send_error_json(500, f"os error: {e}")
            return
        self._send_json({"ok": True, "dir": folder})

    # ---- 路由 -----------------------------------------------------------
    def do_GET(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        query = parse_qs(parsed.query)
        try:
            if path == "/api/tree":
                self._api_tree(query)
            elif path == "/api/state":
                self._api_state()
            elif path == "/api/config":
                self._send_json({
                    "version": APP_VERSION,
                    "root": os.path.basename(root_real().rstrip("\\/")),
                    "dataRoot": DATA_ROOT,
                    "stateDir": STATE_DIR,
                    "examsFile": EXAMS_FILE,
                })
            elif path == "/api/file":
                self._serve_file(query)
            elif path == "/api/zipinfo":
                self._api_zipinfo(query)
            elif path == "/api/text":
                self._api_text(query)
            elif path == "/api/search":
                self._api_search(query)
            elif path == "/api/index":
                self._send_json(INDEX.status)
            elif path == "/api/exams":
                self._api_exams_get()
            elif path == "/api/health":
                self._send_json({"ok": True})
            else:
                self._serve_static(path)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            pass  # 客户端断开（PDF.js 取消请求属正常）
        except Exception as e:  # noqa: BLE001
            LOG.exception("GET %s 处理异常", path)
            try:
                self._send_error_json(500, f"internal error: {e}")
            except Exception:
                pass

    def do_HEAD(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if parsed.path == "/api/file":
            try:
                full, _rel = safe_rel_from_query(query)
            except ValueError as e:
                self._send_error_json(404, str(e))
                return
            if not os.path.isfile(full):
                self._send_error_json(404, "not a file")
                return
            size = os.path.getsize(full)
            ext = os.path.splitext(full)[1].lower()
            self.send_response(200)
            self.send_header("Content-Type", MIME_MAP.get(ext) or "application/octet-stream")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(size))
            self.end_headers()
        else:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/state":
                self._api_state_post()
            elif parsed.path == "/api/open":
                self._api_open()
            elif parsed.path == "/api/shutdown":
                self._api_shutdown()
            elif parsed.path == "/api/exams":
                self._api_exams_post()
            elif parsed.path == "/api/exams/sample":
                self._api_exams_sample()
            elif parsed.path == "/api/exams/clear":
                self._api_exams_clear()
            elif parsed.path == "/api/exams/export":
                self._api_exams_export()
            elif parsed.path == "/api/exams/open-dir":
                self._api_exams_open_dir()
            elif parsed.path == "/api/index/rebuild":
                with INDEX.lock:
                    if INDEX.status["state"] == "building":
                        self._send_json({"ok": False, "message": "索引正在构建中"})
                        return
                threading.Thread(target=INDEX.refresh, kwargs={"force": True}, daemon=True).start()
                self._send_json({"ok": True, "message": "已开始重建索引"})
            else:
                self._send_error_json(404, "unknown api")
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            pass
        except Exception as e:  # noqa: BLE001
            LOG.exception("POST %s 处理异常", parsed.path)
            try:
                self._send_error_json(500, f"internal error: {e}")
            except Exception:
                pass

# ---------------------------------------------------------------------------
# 启动
# ---------------------------------------------------------------------------
def find_free_port(start=8765, end=8775):
    import socket
    for port in range(start, end + 1):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    return None


def main():
    parser = argparse.ArgumentParser(description="大二资料阅读器 本地服务")
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--data-root", default=None)
    parser.add_argument("--state-dir", default=None)
    args = parser.parse_args()

    global DATA_ROOT, STATE_DIR, STATE_FILE, INDEX, RUNTIME_FILE
    if args.data_root:
        DATA_ROOT = os.path.abspath(args.data_root)
    if args.state_dir:
        STATE_DIR = os.path.abspath(args.state_dir)
        STATE_FILE = os.path.join(STATE_DIR, "state.json")
        RUNTIME_FILE = os.path.join(STATE_DIR, "runtime.json")
        globals()["STATE"] = StateStore(STATE_FILE)
        # 考试数据固定在项目 data\ 目录（与 --state-dir 无关）

    if not os.path.isdir(DATA_ROOT):
        print(f"[错误] 资料根目录不存在: {DATA_ROOT}", file=sys.stderr)
        print("      请用 --data-root <目录> 指定，或设置环境变量 COURSE_READER_DATA_ROOT，", file=sys.stderr)
        print("      或在 data/library-root.txt 第一行写入你的课程资料目录。", file=sys.stderr)
        sys.exit(1)

    # --data-root/--state-dir 之后按实际目录重建索引器（模块级 INDEX 用的是默认路径）
    INDEX = Indexer(DATA_ROOT, os.path.join(STATE_DIR, "cache"))

    os.makedirs(STATE_DIR, exist_ok=True)
    setup_logging()

    port = args.port or find_free_port()
    if port is None:
        print("[错误] 8765-8775 端口均被占用，无法启动。", file=sys.stderr)
        sys.exit(1)

    server = QuietServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    url = f"http://127.0.0.1:{port}/"
    LOG.info("资料根目录: %s", DATA_ROOT)
    LOG.info("运行数据目录: %s", STATE_DIR)
    LOG.info("服务已启动: %s  （关闭此窗口或按 Ctrl+C 退出）", url)

    # 启动即后台增量建索引（首次全量，之后秒级增量）
    threading.Thread(target=INDEX.refresh, daemon=True).start()

    try:
        with open(RUNTIME_FILE, "w", encoding="utf-8") as f:
            json.dump({"url": url, "port": port, "startedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
                       "pid": os.getpid()}, f, ensure_ascii=False)
    except OSError:
        pass

    if not args.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open_new_tab(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        LOG.info("服务已退出。")


if __name__ == "__main__":
    main()
