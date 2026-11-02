# -*- coding: utf-8 -*-
"""验证 /api/tree 的缓存 + ETag/304 行为，并测扫描耗时。"""
import json, time, urllib.request, urllib.error

BASE = "http://127.0.0.1:8765"


def get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            body = r.read()
            return r.status, dict(r.headers), body, (time.perf_counter() - t0) * 1000
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read(), (time.perf_counter() - t0) * 1000


for i in range(20):
    try:
        st, _, _, _ = get(BASE + "/api/health")
        if st == 200:
            break
    except Exception:
        time.sleep(0.25)

print("== 冷/热对比 ==")
for i in range(3):
    st, h, body, ms = get(BASE + "/api/tree")
    print(f"  #{i+1} status={st} {ms:6.1f}ms {len(body)/1024:5.1f}KB etag={h.get('ETag')} scan={h.get('X-Scan-Ms')}")

st, h, body, ms = get(BASE + "/api/tree?fresh=1")
print(f"  fresh status={st} {ms:6.1f}ms {len(body)/1024:5.1f}KB scan={h.get('X-Scan-Ms')}")
etag = h.get("ETag")

print("\n== 304 协商 ==")
for i in range(2):
    st, h2, body2, ms = get(BASE + "/api/tree", {"If-None-Match": etag})
    print(f"  #{i+1} status={st} {ms:6.1f}ms body={len(body2)}B etag={h2.get('ETag')}")

print("\n== 数据完整性 ==")
tree = json.loads(body.decode("utf-8"))
print("  courses:", tree["stats"]["courses"], "files:", tree["stats"]["files"], "size:", tree["stats"]["sizeText"])
print("  首课程:", tree["courses"][0]["name"], "子项:", len(tree["courses"][0]["children"]))
