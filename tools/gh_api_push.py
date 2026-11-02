#!/usr/bin/env python3
"""通过 GitHub REST API 推送当前 HEAD（备用通道）。

为什么需要它：本机 `github.com:443` 常被网络阻断（`git push` 报
"Failed to connect to github.com port 443"），而 `api.github.com` 可达。
这个脚本用 git 数据 API（blob → tree → commit → ref）把本地 HEAD
整个镜像到远端，只上传内容发生变化的 blob。

用法：
    python tools/gh_api_push.py                 # 推送 HEAD
    python tools/gh_api_push.py "自定义提交信息"

令牌来源（按顺序）：环境变量 GITHUB_TOKEN / GH_TOKEN → Windows 凭据管理器里
的 GitHub 凭据（需 repo 权限）。推送后远端分支会指向一个新提交，
提交的 tree 与本地 HEAD 完全一致（sha 不同，因为父提交不同）。
"""
import base64
import ctypes
import hashlib
import json
import os
import subprocess
import sys
import urllib.request
from ctypes import wintypes

REPO = os.environ.get("GH_REPO", "wuyan18/atelier-study")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


# ---------------------------------------------------------------- 令牌
def find_token():
    for key in ("GITHUB_TOKEN", "GH_TOKEN"):
        if os.environ.get(key):
            return os.environ[key].strip()

    class CREDENTIAL(ctypes.Structure):
        _fields_ = [
            ("Flags", wintypes.DWORD), ("Type", wintypes.DWORD),
            ("TargetName", wintypes.LPWSTR), ("Comment", wintypes.LPWSTR),
            ("LastWritten", wintypes.FILETIME), ("CredentialBlobSize", wintypes.DWORD),
            ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)), ("Persist", wintypes.DWORD),
            ("AttributeCount", wintypes.DWORD), ("Attributes", ctypes.c_void_p),
            ("TargetAlias", wintypes.LPWSTR), ("UserName", wintypes.LPWSTR),
        ]

    advapi = ctypes.WinDLL("advapi32", use_last_error=True)
    advapi.CredEnumerateW.restype = wintypes.BOOL
    count = wintypes.DWORD()
    creds = ctypes.POINTER(ctypes.POINTER(CREDENTIAL))()
    if not advapi.CredEnumerateW(None, 0, ctypes.byref(count), ctypes.byref(creds)):
        return None
    fallback = None
    for i in range(count.value):
        cred = creds[i].contents
        name = cred.TargetName or ""
        if "github" not in name.lower():
            continue
        blob = ctypes.string_at(cred.CredentialBlob, cred.CredentialBlobSize)
        for enc in ("utf-16-le", "utf-8"):
            try:
                tok = blob.decode(enc).strip("\x00").strip()
            except Exception:
                continue
            if tok.startswith(("ghp_", "gho_", "github_pat_")):
                if "api.github.com" in name:
                    return tok
                fallback = fallback or tok
    return fallback


def api(token, method, path, payload=None):
    url = "https://api.github.com" + path
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "token " + token)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "atelier-study-push")
    if data:
        req.add_header("Content-Type", "application/json")
    with OPENER.open(req, timeout=120) as resp:
        body = resp.read().decode()
    return json.loads(body) if body.strip() else {}


# ---------------------------------------------------------------- git
def git(*args):
    return subprocess.run(["git"] + list(args), cwd=ROOT, capture_output=True,
                          text=True, encoding="utf-8", errors="surrogateescape",
                          check=True).stdout


def local_tree():
    """返回 [(path, mode, blob_sha)]，blob_sha 即 git 对象 sha。"""
    out = git("ls-tree", "-r", "-z", "HEAD")
    items = []
    for rec in out.split("\x00"):
        if not rec.strip():
            continue
        meta, path = rec.split("\t", 1)
        mode, kind, sha = meta.split()
        if kind != "blob":
            continue
        items.append((path, mode, sha))
    return items


def hashes():
    """返回 {path: (sha, is_binary)} —— binary 用 NUL 探测。"""
    out = {}
    for path, mode, sha in local_tree():
        full = os.path.join(ROOT, path.replace("/", os.sep))
        with open(full, "rb") as fh:
            raw = fh.read()
        out[path] = (sha, b"\x00" in raw[:8000], mode, raw)
    return out


def main():
    message = sys.argv[1] if len(sys.argv) > 1 else git("log", "-1", "--pretty=%B").strip()
    token = find_token()
    if not token:
        print("找不到 GitHub 令牌（GITHUB_TOKEN 或凭据管理器）")
        return 2
    print("令牌用户:", api(token, "GET", "/user").get("login"))

    ref = api(token, "GET", f"/repos/{REPO}/git/ref/heads/main")
    remote_sha = ref["object"]["sha"]
    remote = api(token, "GET", f"/repos/{REPO}/git/trees/{remote_sha}?recursive=1")
    known = {t["path"]: t["sha"] for t in remote["tree"] if t["type"] == "blob"}
    print("远端 HEAD:", remote_sha[:8], "| 文件", len(known))

    files = hashes()
    entries, uploaded = [], 0
    for path in sorted(files):
        sha, is_bin, mode, raw = files[path]
        if known.get(path) != sha:
            api(token, "POST", f"/repos/{REPO}/git/blobs", {
                "content": base64.b64encode(raw).decode(), "encoding": "base64"})
            uploaded += 1
            print("  上传", path)
        entries.append({"path": path, "mode": mode, "type": "blob", "sha": sha})

    removed = [p for p in known if p not in files]
    for path in removed:
        print("  删除", path)

    if not uploaded and not removed:
        print("远端已与 HEAD 一致，无需推送")
        return 0

    tree = api(token, "POST", f"/repos/{REPO}/git/trees", {"tree": entries})
    commit = api(token, "POST", f"/repos/{REPO}/git/commits",
                 {"message": message, "tree": tree["sha"], "parents": [remote_sha]})
    api(token, "PATCH", f"/repos/{REPO}/git/refs/heads/main",
        {"sha": commit["sha"], "force": False})
    print(f"已推送 {uploaded} 个新 blob，删除 {len(removed)} 个 → {commit['sha'][:8]}")
    print("本地 HEAD:", git("rev-parse", "--short", "HEAD").strip(),
          "（tree 相同，sha 不同属正常）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
