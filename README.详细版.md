# 大二资料阅读器 · 详细设计与实现说明

> 这份文档不是"怎么用"，而是**"它是怎么实现的、界面是怎么摆的、哪里还能改"**。
> 用途：交给后续的优化者（人或 AI）作为唯一入口，读完即可定位每一处代码、判断每处改动的副作用。
> 快速上手请看同目录的 `README.md`；逐阶段验收记录与踩坑见 `PROJECT_STATUS.md`。
>
> 对应版本：`server.py` 内 `APP_VERSION = "P1.0"`（server.py:27），2026-11-02 状态。
> 当前资料规模：9 门课程 / 103 个文件 / 326.0 MB，其中 51 个 PDF、760 页已建立全文索引。

---

## 0. 一句话概括

一个**零依赖、纯本地、只读**的课程资料浏览器：后端是 1000 行 Python 标准库 HTTP 服务，前端是 7 个原生 ES Module + 1 个 CSS 文件，没有任何构建步骤、没有 node_modules、断网可用；打开网页即可看书架、进目录树、读 PDF/Markdown/DOCX/代码/图片/ZIP、把"作业题目"和"我的作答"并排对照，并全文搜索所有 PDF 的文字层。

设计上的三条硬约束（后续优化请勿破坏）：

1. **资料目录全程只读**——服务不写用户资料目录的任何一个字节，所有状态写到 `%LOCALAPPDATA%\course-reader\`。
2. **离线可用**——所有第三方库（pdf.js / marked / KaTeX / Prism / mammoth）都在 `vendor/` 内，不请求 CDN。
3. **无构建工具**——浏览器直接跑源码，改完刷新即生效，方便非前端背景的人维护。

---

## 1. 目录结构

```
<项目目录>\
├─ 启动.bat                  # 双击启动：探测端口→起服务→等就绪→开浏览器（CRLF + chcp 65001）
├─ server.py                 # 后端全部逻辑（1078 行，单文件）
├─ index.html                # 唯一页面（SPA 外壳 + SVG 图标精灵 + vendor 脚本引入，105 行）
├─ favicon.svg / app.ico     # 浏览器标签图标 / 桌面快捷方式图标（同一图形）
├─ README.md                 # 面向使用者的简要说明
├─ README.详细版.md          # ← 本文件
├─ PROJECT_STATUS.md         # 阶段 0/P0/P1/P2/P3/P4 的验收记录与工程教训
├─ css\
│  └─ style.css              # 全部样式（740 行，含深色模式与响应式）
├─ js\
│  ├─ app.js                 # 内核：API、状态、路由、顶栏、toast（265 行）
│  ├─ library.js             # 书架页 + 课程页目录树（302 行）
│  ├─ reader.js              # 阅读页壳 + PDF 阅读器 PdfViewer（558 行）
│  ├─ viewers.js             # Markdown/DOCX/代码/图片/ZIP/未知 六种查看器（331 行）
│  ├─ assignment.js          # 作业题目↔作答 配对与对照页（257 行）
│  ├─ search.js              # 搜索结果页 + 索引状态（197 行）
│  └─ formats.js             # 扩展名→视图/图标/语言 的唯一真源（161 行）
├─ vendor\                   # 本地化的第三方库（勿改）
│  ├─ pdfjs\                 # pdf.js 5.6.205（含 worker、cmaps、wasm）
│  ├─ marked\ katex\ prismjs\ mammoth\
└─ tests\                    # 验收脚本（CDP 驱动 Chrome）+ 生成的截图
```

资料根目录（只读）默认为 `..\大二`，可用 `--data-root` 覆盖。
运行数据目录默认 `%LOCALAPPDATA%\course-reader`，含 `state.json`、`cache\`（索引缓存）、`logs\server.log`。

---

## 2. 启动与进程模型

### 2.1 三种启动方式

| 方式 | 行为 |
|---|---|
| 桌面快捷方式 `大二资料阅读器.lnk` | 目标 `启动.bat`，窗口最小化，图标 `app.ico` |
| 双击 `启动.bat` | 见 2.2 的完整流程 |
| 命令行 `python server.py --no-browser --port 8765` | 开发用；参数见 2.4 |

### 2.2 `启动.bat` 的流程（为什么这么写）

```
chcp 65001                     # 代码页切 UTF-8，否则中文路径乱码
探测 http://127.0.0.1:8765/api/health
 ├─ 已通 → 直接 start 浏览器，退出（不会重复起第二个服务）
 └─ 不通 → start /min python server.py --port 8765 → 轮询 health（40 次 × 250ms）
           → 就绪才开浏览器；超时则提示日志路径并 pause
```

两个必须遵守的坑（踩过，别再改回去）：

- **文件必须是 CRLF 换行 + 无 BOM 的 UTF-8**。写成 LF 会让 `if (...)`/`for` 块解析错位，cmd 会把中文和后面的字符粘在一起执行，报 `'thon' is not recognized` 这类怪错。
- **不要用 `timeout /t`**，它依赖 stdin，在重定向场景直接报 "Input redirection is not supported"；本项目用 `ping -n` 代替等待。

### 2.3 端口

`find_free_port(8765, 8775)`（server.py:1003）：默认 8765，被占用就顺延。前端所有请求都用相对路径，因此换端口不影响功能。

### 2.4 命令行参数

```
python server.py [--port N] [--no-browser] [--data-root DIR] [--state-dir DIR]
```

- `--data-root`：资料目录（默认读 `data/library-root.txt`，兜底 `~/Documents/课程资料`）
- `--state-dir`：状态/缓存目录（默认 `%LOCALAPPDATA%\course-reader`），**测试时务必指向临时目录**，否则会污染真实阅读进度。

### 2.5 进程与并发模型

单进程 + `ThreadingHTTPServer`（每请求一线程）：

- 目录树：`_TREE_LOCK` 保护，缓存 2 秒（见 3.4）。
- 索引：`Indexer` 内部 `threading.Lock`，后台线程构建，`status` 状态机对前端可查。
- 状态：`StateStore` 用锁 + 原子写（tmp → `os.replace`），并发 POST 不会写出半个 JSON。
- 只监听 `127.0.0.1`，不接受外部连接；`/api/shutdown` 只用来实现"退出服务"按钮。

---

## 3. 后端实现（server.py）

### 3.1 代码分区（按行号导航）

| 行号 | 内容 |
|---|---|
| 1–90 | 导入、常量（`APP_VERSION`、`DATA_ROOT`、`STATE_DIR`、`IGNORE_PATTERNS`）、日志 |
| 94–148 | `StateStore`：读写 `state.json` |
| 151–360 | `Indexer`：pdftotext 全文索引（构建/增量/搜索/摘要） |
| 368–400 | 路径安全：`root_real` / `resolve_rel` / `safe_rel_from_query` |
| 404–536 | 目录扫描：`_ignored` / `_file_node` / `_scan_dir` / `_scan_dir_node` / `scan_library` |
| 538–563 | `scan_library_cached`：2 秒缓存 + 稳定 ETag |
| 565–585 | `QuietServer`：静默客户端断连异常 |
| 590–960 | `Handler`：静态资源、文件流、各 API |
| 1003–1078 | 端口选择、`main()` |

### 3.2 HTTP 接口表

| 方法 | 路径 | 参数 | 返回 | 备注 |
|---|---|---|---|---|
| GET | `/` | — | index.html | 静态，带 ETag |
| GET | `/api/tree` | `fresh=1` 强制重扫 | 整棵目录树 JSON | 2s 缓存、ETag、`X-Scan-Ms` |
| GET | `/api/state` | — | `{version,progress,completed,settings}` | 前端启动时读一次 |
| GET | `/api/config` | — | `{version,root,dataRoot,stateDir}` | 调试/关于用 |
| GET | `/api/file` | `path=` | 文件字节流 | 支持 Range（206/416），PDF 靠它流式读 |
| GET | `/api/zipinfo` | `path=` | `{entries:[{name,size,compressed,dir}]}` | 只读清单，不解压 |
| GET | `/api/text` | `path=`,`max=` | `{rel,content,size,truncated,encoding}` | 默认 200 KB 上限，编码自动探测 |
| GET | `/api/search` | `q=`,`maxHits=` | `{query,results,totalFiles,totalHits,index}` | 逐页子串匹配 |
| GET | `/api/index` | — | 索引状态 | 前端显示"已索引 N/M 页" |
| GET | `/api/health` | — | `{ok:true,...}` | 启动脚本用它探活 |
| POST | `/api/state` | 整个 state JSON | `{ok:true}` | 覆盖写 |
| POST | `/api/open` | `{path,mode}` | `{ok:true}` | `mode=open` 系统打开；`reveal` 资源管理器定位 |
| POST | `/api/shutdown` | — | `{ok:true}` | 关服务（"退出服务"按钮） |

### 3.3 目录扫描（`scan_library`，server.py:485）

**每次请求（缓存未命中时）全量重扫，不做文件监听**——这是"新资料自动出现"的实现基础，代价是每次约 90–110 ms。

关键规则：

1. **忽略**（`IGNORE_PATTERNS`，server.py:44）：`~$*`（Office 临时文件）、`desktop.ini`、`*.tmp`、`.DS_Store`。
2. **排序**（`_scan_dir`，server.py:432）：`sorted(key = (not name[:2].isdigit(), name))` —— **两位数数字前缀的目录排前面**（`01-课件`、`02-作业`…），其余按字典序。最终 `children.sort(key = (type != "dir", name))`：目录永远在文件前。
3. **节点形状**（`_file_node`，server.py:418）：
   ```json
   {"type":"file","name":"作业01-题目.pdf","rel":"形式语言与自动机/02-作业/作业01/作业01-题目.pdf",
    "ext":"pdf","size":182734,"sizeText":"178.5 KB","mtime":"2026-10-30 09:12"}
   ```
   `ext` 取自 `splitext(name)[1].lstrip(".").lower()`——**去掉点**，因为前端 `formats.js` 的表以不带点的扩展名为键（历史上这里带点导致所有文件落到"未知格式"页，是必须记住的约定）。
4. **归档**（`_scan_dir_node`，server.py:471）：路径中任一段以 `99-` 开头 → `archive: true`，前端灰显并折叠，不进作业统计。
5. **空目录**：`empty = (file_count == 0)`（递归统计），前端用来折叠聚合。
6. **课程统计**：扫描完顶层目录后，对每门课额外 `os.walk` 一次数 PDF → `stats.pdfs`；同时累加 `stats.files / sizeBytes / sizeText / courses`。
7. 顶层结构固定为 `{root, generatedAt, version, stats, courses[], rootFiles[]}`；"课程"= 资料根下的第一层目录（名字里含"公式手册"这类也算课程，不做语义判断）。

### 3.4 树缓存与 ETag（`scan_library_cached`，server.py:538）

```
请求 /api/tree
 ├─ ?fresh=1 → 强制重扫，跳过 304
 ├─ 缓存 age < 2.0s → 直接用缓存的字节
 └─ 否则重扫 → 序列化 → 计算 ETag
```

- **TTL = 2.0 秒**（`TREE_TTL_SECONDS`）：足够吸收一次页面加载里的多次 `/api/tree`，又不会让"重新扫描"之外的新增文件等太久。
- **ETag 用"去掉 `generatedAt` 的内容"算 sha1**——若把时间戳算进去，每 2 秒 ETag 都变，`If-None-Match` 永远不命中 304。
- 命中 304 时返回 `Content-Length: 0` 的空体；200 时带 `X-Scan-Ms` 便于前端/测试观察真实扫描耗时。
- 实测：冷 108.5 ms（其中纯扫描 93.4 ms）/ 热 15.5–17.7 ms / `fresh=1` 107.7 ms / 304 体 0 字节 / 载荷 47 KB。

### 3.5 静态资源（`_serve_static`，server.py:616）

- 安全：先拦 `..` 与 `\x00`，再 `realpath` 判断是否仍在项目根内（防目录穿越）。
- 缓存：`ETag = "{mtime_ns:x}-{size:x}"`，`If-None-Match` 命中回 304，`Cache-Control: no-cache`（允许缓存但必须协商）。
  > 这条是 P1 期间的关键修复：此前只有 `no-cache` 而没有 ETag/Last-Modified，Chrome 会一直复用内存里的旧 JS，改了代码"看起来没生效"。

### 3.6 文件流（`_serve_file`，server.py:664）

- 支持 `Range: bytes=a-b` 与 `bytes=-N`（pdf.js 分块拉取、视频/大图预览都依赖）。
- 越界回 416 + `Content-Range: bytes */size`；命中回 206 + `Content-Range`。
- 1 MB 分块写，避免大 PDF 一次性读进内存。
- `Content-Disposition: inline`：PDF 走浏览器内建/pdf.js，不触发下载。

### 3.7 文本接口（`_api_text`，server.py:761）

- 上限 `max` 默认 204800 字节，强制夹在 `[1024, 4MB]`。
- 编码探测：`utf-8` → `gb18030` → `utf-8(errors="replace")`，返回实际用的编码。
- 截断时**回退到最后一个换行**，避免把多字节字符/半行切开导致乱码。
- 前端 `CodeViewer` 用它读源码；超过上限的文件会在页面上显示截断提示条。

### 3.8 ZIP 清单（`_api_zipinfo`，server.py:723）

`zipfile.ZipFile.namelist()` 逐条取 `file_size` / `compress_size` / `is_dir()`，**不解压**。坏包/非 zip 会被 `Handler` 的异常兜底转成 400 JSON，前端显示"压缩包清单读取失败"而不是白屏。

### 3.9 全文索引（`Indexer`，server.py:151）

```
构建：遍历所有 .pdf → 对每个文件调 pdftotext -layout → 得到逐页文本
      → 写 cache\<sha1(路径)>.json （{"pages":["第1页文本", ...]}）
      → 更新 manifest（path, size, mtime_ns, pages）
增量：refresh(force=False) 时比对 size + mtime_ns，未变则复用旧缓存
搜索：search(q, max_hits_per_file=50, snippet_pad=40)
      → 对每页 casefold().find() 逐处命中 → 生成前后 40 字符的摘要（压平空白 + …）
```

- 状态机：`building` / `ready` / `error`，`status` 里带 `indexed/total/pages/scanned/failed/changed/durationMs/lastBuild`，前端"索引状态"面板直接展示。
- **只索引 PDF**，因为只有 PDF 需要 OCR 之外的手段取文字层；MD/DOCX/代码由前端直接读，不建索引（见第 9 节优化项）。
- 扫描件（无文字层的 PDF，如 `复变函数/复变.pdf`）索引结果为 0 页，搜索页会明确提示"该文件无文字层"。
- 匹配是**纯子串 + casefold**，没有分词、没有倒排、没有相关性排序；结果按文件聚合后按命中数排序。

### 3.10 状态存储（`StateStore`，server.py:94）

```json
{
  "version": 1,
  "progress": {
    "数据结构/03-实验/实验01/报告/report.pdf": {"page": 2, "total": 18, "ts": 1793594395777},
    "复变函数/复变函数-课堂笔记大纲.md": {"scroll": 0.42, "ts": 1793594344821}
  },
  "completed": {"形式语言与自动机/02-作业/作业01": true},
  "settings": {}
}
```

- 写：整份 JSON 覆盖写，先写 `state.json.tmp` 再 `os.replace`（原子，断电不会留半个文件）。
- 读：`load()` 只保留 4 个白名单键（`version/progress/completed/settings`，server.py:101–108）。
  > ⚠️ 已知缺陷：前端还会写 `expandedDirs`（目录展开状态），但 `load()` 白名单会把它丢掉 → **重启后目录树展开状态不保留**。修法见 9.1。
- 进度有两种形态：PDF 记 `{page,total}`，长文档（MD/DOCX/代码）记 `{scroll}`（0–1 的比例，跨分辨率可用）。

### 3.11 安全边界

- 所有路径参数走 `safe_rel_from_query` → `resolve_rel`：`unquote` → 拼到 `root_real` → `realpath` → 校验前缀，越界一律 400。
- 只绑定 `127.0.0.1`，无鉴权（本机单用户场景）。
- `open` / `reveal` 只对通过校验的路径执行 `os.startfile` / `explorer /select`。

---

## 4. 前端架构

### 4.1 模块依赖图

```
index.html
  └─ <script type="module" src="/js/app.js">      ← 唯一入口
        ├─ library.js     (书架 / 课程树 / 文件行)
        │     ├─ formats.js   （格式真源：图标、徽章、是否可预览）
        │     └─ assignment.js（作业统计 courseAssignStats）
        ├─ reader.js      (阅读页壳 + PdfViewer)
        │     └─ viewers.js   （md/docx/code/image/zip/unknown）
        │           └─ formats.js
        ├─ assignment.js  (对照页)
        │     ├─ reader.js 的 PdfViewer
        │     └─ viewers.js 的 createViewerFor
        ├─ search.js      (搜索页)
        └─ formats.js
```

依赖方向是单向的：`app.js` 是一切的底座（提供 `api/getTree/getState/saveState/toast/G/esc/fmtSize/openPath/getProgress/setProgress/isCompleted/setCompleted/findNode/refreshTree`），其余模块只 import 它，它除了 `await import("./library.js")` 这类懒加载外不反向依赖具体视图。

### 4.2 路由（hash 路由，app.js:159 `route()`）

| hash | 视图 | 参数 |
|---|---|---|
| `#/` | 书架 | — |
| `#/course/<相对路径>` | 课程页（目录树） | 路径需 `encodeURIComponent` |
| `#/read?path=<rel>&page=N` | 阅读页 | `page` 可选，PDF 直达页码 |
| `#/compare?dir=<rel>` | 作业对照 | 目录相对路径 |
| `#/search?q=<kw>` | 搜索结果 | `q` 必填 |

`route()` 的流程：

```
解析 hash → 取 #main
  → cleanupFn?.()            // 销毁上一个视图（PdfViewer.destroy、事件解绑）
  → main.className / innerHTML 重置
  → tools.innerHTML = "" 后挂「重新扫描」按钮
  → 调对应 render（library / reader / assignment / search）
  → setCrumb([...]) + document.title
  → 异常统一 catch → .error-card（带"返回"按钮）
```

切页销毁靠 `cleanupFn` 闭包：每个 render 返回一个清理函数，`route()` 在下次进入时先调用它——这是避免 `IntersectionObserver`/`ResizeObserver`/滚动监听泄漏的唯一机制，**新增视图必须返回 cleanup**。

### 4.3 状态管理与持久化

- `G = { tree, state, stateSaveTimer }`（app.js:45）是全局可变状态，视图直接读写。
- 写状态**永远合并后整体 POST**：`setProgress` / `setCompleted` 都是先改 `G.state`，再 `clearTimeout` + 600 ms 防抖 `saveState`。
- 目录展开状态由 `library.js` 自己管：`G.state.expandedDirs[rel] = true`，800 ms 防抖保存（`queueSaveExpanded`）。
- 进度读取时机：视图挂载时（PDF 从 `page` 恢复，长文档按 `scroll` 比例恢复）。

### 4.4 格式判定（formats.js）——唯一真源

`FORMATS` 表（formats.js:27）的每一行形如：

```js
pdf:  T("pdf",  "pdf",  "none", ""),          // 视图类型, 分组(决定图标/徽章), 高亮语言, 说明
md:   T("md",   "md",   "markdown", ""),
go:   T("code", "code", "go", ""),
rar:  T("none", "zip",  "none", "只支持 .zip 的清单预览；.rar 请用系统程序解压。"),
```

对外 API：

| 函数 | 用途 |
|---|---|
| `formatFor(nameOrNode)` | 返回 `{ext, view, group, lang, note, badge, icon}` |
| `viewerKindFor(name)` | 决定用哪个查看器（`pdf/md/docx/code/image/zip/none`） |
| `prismLangFor(name)` | Prism 语言 id |
| `isImageName / isReadableName` | 画廊过滤 / 判断"能否在站内预览" |

`library.js` 的图标与徽章、`viewers.js` 的查看器分派、`assignment.js` 的对照挂载全部读这张表——**新增格式只改这一个文件**（必要时再补一个 Prism 组件）。

### 4.5 PDF 阅读器（reader.js `PdfViewer`，server.py 之外的复杂度中心）

结构：

```
PdfViewer(container, node, initialPage, mode)
  mode = "full"（整页阅读） | "pane"（作业对照里的一栏）
  _buildChrome()  → 工具条 + .pdf-scroll > .pdf-pages
  load()          → pdfjsLib.getDocument({url:"/api/file?path=...", ...PDFJS_OPTS})
  _buildDom()     → 按页宽/缩放生成 N 个 .r-page 占位
  _observe()      → IntersectionObserver(rootMargin:"120% 0px") 视口附近才渲染 canvas
  _renderPage(n)  → canvas + .textLayer（可选中、可高亮）
  _scheduleDestroy(n) → 远离视口的页回收 canvas，控制内存
```

要点：

- **懒渲染**：只渲染视口 ±120% 内的页；ckeditor 式一次性渲染 100+ 页会卡死。
- **文字层**：每页叠一个 `TextLayer`，用途是"鼠标可选中复制"和"页内搜索高亮"。
- **页内搜索**：`_doSearch` 在已渲染页的 textLayer 上找 `Range`，`_applyHighlight` 包 `<mark>`，`_jumpHit` 滚动定位；未渲染的页会先补渲染再找。
- **缩放/适宽**：`_setScale` 统一改 CSS 宽度并触发重渲染；`_computeFit` 按容器宽算适宽比例。
- **页码同步**：滚动时 `_currentPageFromScroll` 用页顶位置反推当前页，写回输入框；输入框回车 `_scrollToPage`。
- **进度保存**：滚动停止后 `setProgress(rel, page, total)`。
- **对照页复用**：`mode="pane"` 时工具条精简（无返回/无搜索），并由外部 `assignment.js` 负责同步滚动（见 4.7）。

### 4.6 其余查看器的统一契约

每个查看器是工厂函数，返回 `{ mount(container, node, siblings), destroy(), kind }`：

| 查看器 | 位置 | 关键实现 |
|---|---|---|
| `MdViewer` | viewers.js:19 | `.doc-meta` 信息条 + `.md-view`；`marked.parse` → `renderMathInElement`（`$$`/`$`/`\(`/`\[`，`throwOnError:false`）→ 对 `pre code` 调 `Prism.highlightElement`；按比例恢复滚动 |
| `DocxViewer` | viewers.js:104 | `mammoth.convertToHtml({arrayBuffer})`，只保留语义标签；复杂版式会简化，页面顶部有提示 |
| `CodeViewer` | viewers.js:145 | `/api/text` 取文本（200 KB 上限）+ Prism 高亮 + 行号；超限显示 `.truncate-banner` |
| `ImageViewer` | viewers.js:186 | `.img-stage`（缩放/适宽/1:1）+ 同目录图片 `.img-gallery` 缩略图条 |
| `ZipViewer` | viewers.js:254 | `/api/zipinfo` 表格（名称/原始/压缩），目录行灰显 |
| `UnknownViewer` | viewers.js:293 | 显示 `formatFor().note` 的说明 + "系统打开/在资源管理器中显示" |

### 4.7 作业对照（assignment.js）

**配对算法**（`analyzeDir`，assignment.js:15）：

1. 候选文件 = 目录的直接子文件 + **一层**子目录里的文件（`homework-5/assignment-5.pdf` 这种结构也能配上）。
2. 角色判定（按文件名）：
   - 含 `题目` → `question`
   - 含 `作答` 或 `答案` → `answer`
   - `^assignment[\w.-]*$` 且扩展名 ∈ {pdf, docx, md} → `question`（`inferred=true`，英文作业名兜底）
3. 同一角色有多个候选时按 `prefs = {pdf:0, docx:1, md:2}` 取最优（PDF 优先）。
4. 落选文件进 `unclassified`，在页面底部单列，**不强行配对**（宁可让用户自己点开，也不猜错）。
5. `assignable = !!(question || answer)`：只有一侧也能进对照页（另一侧显示 📭 暂无）。

**挂载**（`mountPane`）：按 `viewerKindFor()` 分派——PDF 用 `PdfViewer(mode="pane")`，其余用 `createViewerFor()` 并给 `.pane-holder` 加 `.scrollable` 让它自己滚。

**同步滚动**（`syncFrom`）：比例同步 `dst.scrollTop = src.scrollTop / srcMax * dstMax`；两侧各自带 `syncing` 标记，配合 `requestAnimationFrame` 解锁，避免 A→B→A 振荡。

### 4.8 搜索页（search.js）

- 请求 `/api/search?q=`，结果按文件聚合：`.search-hit-card` > `.hit-file`（文件名 + 路径 + "N 处命中 · 共 M 页"）+ `.hit-lines`（最多 5 条，超出显示"另有 N 处命中"）。
- 摘要高亮：`highlightSnippet` 对命中词做大小写不敏感切分，包 `<mark>`。
- 点击结果 → `#/read?path=...&page=N`，PDF 直接跳到命中页。
- 顶部有索引状态条（`/api/index`）：未建完时显示进度，提供"重建索引"按钮。

---

## 5. 界面布置（UI 布局）

### 5.1 设计语言

| 令牌 | 值 | 用途 |
|---|---|---|
| `--bg` | `#f7f5f1` | 页面底色（暖纸，降低长时间阅读的冷白刺眼） |
| `--panel` | `#fff` | 卡片/顶栏 |
| `--panel-soft` | `#fbfaf7` | 输入框、次级块 |
| `--line` | `#e8e3da` | 分隔线/描边 |
| `--ink` / `--text` / `--muted` / `--faint` | `#1b1917` / `#2a2622` / `#7a756c` / `#a8a29a` | 四级文字层次 |
| `--accent` / `--accent-2` | `#4b5ce0` / `#7a5cf0` | 主色（链接、选中、进度条）与渐变副色 |
| `--ok` / `--warn` / `--danger` | `#0f7b52` / `#a6630a` / `#c0392b` | 完成/提示/错误 |
| `--hit` | `#ffe58a` | 搜索高亮底色 |
| 圆角 | 8 / 12 / 16 px | 小控件 / 卡片 / 大容器 |
| 阴影 | 4 档 | 卡片默认几乎无阴影，hover 抬起一档 |

字体栈：系统 UI 字体（`-apple-system, "Segoe UI", "Microsoft YaHei"...`）；代码用 `Cascadia Code / Consolas`。

### 5.2 全局骨架（每页共用）

```
┌──────────────────────────────────────────────────────────────────────┐
│ #topbar  高 58px · sticky · 毛玻璃(blur 14px) · 底部 1px 描边        │
│ ┌──────┐ ┌───────────────────────────┐  面包屑         ┌───────────┐ │
│ │ logo │ │ 🔍 全文搜索 PDF 文字层  [/]│  全部课程/数据结构│ 重新扫描 退出服务│ │
│ └──────┘ └───────────────────────────┘                 └───────────┘ │
├──────────────────────────────────────────────────────────────────────┤
│ #main   flex:1 · overflow:auto   ← 只有这块滚动，顶栏永远可见        │
│                                                                      │
│        （各页内容，最大宽度居中：书架 1180 / 课程 1100）              │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│ #toast  固定在底部居中，默认 .hidden，显示 2.6s 后淡出                │
└──────────────────────────────────────────────────────────────────────┘
```

- 顶栏四段：`logo`（28px 渐变方块 + 文字）· 搜索（`flex:0 1 300px`，高 34px，胶囊圆角，左图标右 `/` 键提示）· 面包屑（`flex:1`，超长省略）· 工具区（`margin-left:auto`）。
- 页面级滚动只在 `#main` 上，避免"顶栏跟着滚走"。

### 5.3 书架页（`#/`）

```
                    书架 ▁▁▁(渐变色下划线)          ┌ 326.0 MB ┐ ┌ 103 个文件 ┐
                    9 门课程 · 103 个文件 · 326.0 MB
┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐ ┌────────────────┐
│ [复] 复变函数   → │ │ [大] 大物      → │ │ [形] 形式语言…  → │ │ [微] 微积分… → │
│      3 个文件·1 PDF│ │      0 个文件     │ │      30 个文件     │ │   2 个文件      │
│ 暂无作业目录 45.2MB│ │ 空课程        0 B │ │ 作业 1/5 ✓  15.6MB│ │ 暂无作业…105 KB│
│ ░░░░░░░░░░░░░░░░░ │ │ ░░░░░░░░░░░░░░░░ │ │ ██████░░░░░░░░░░ │ │ ░░░░░░░░░░░░░░ │
└───────────────────┘ └───────────────────┘ └───────────────────┘ └────────────────┘
                        ……（auto-fill 网格，最小 268px，间距 16px）

根目录文件 ─────────────────────────────────────────────────────────────
  📄 _整理说明.md   MD                                        3.2 KB
```

卡片解剖（`library.js:43`）：

```
article.course-card.tone-N
├─ .card-head
│  ├─ .card-tile          ← 40px 圆角方块，填课程名首字，六套渐变按索引循环
│  ├─ .card-titles
│  │  ├─ .card-title      ← 课程名
│  │  └─ .card-sub        ← "3 个文件 · 1 个 PDF"
│  └─ .card-go            ← 箭头，hover 右移 2px
└─ .card-progress（有作业）| .card-progress.empty（无作业）
   ├─ .cp-head: .card-assign「作业 1/5 ✓」  .cp-size「15.6 MB」
   └─ .cp-bar > i          ← 宽度 = 完成率
   空态: .cp-note「暂无作业目录 / 空课程」 .cp-size  .cp-note-bar（虚线占位条）
```

交互：整卡可点（`click` / `Enter` / `Space`）→ `#/course/<rel>`；hover 抬起阴影 + 箭头位移。

### 5.4 课程页（`#/course/<rel>`）

```
数据结构
20 个文件 · 3 个 PDF · 38.3 MB                ┌ ✓ 作业 0/1 ┐ ┌ 27 个目录 ┐
┌──────────────────────────────────────────────────────────────────────┐
│ ▾ 📁 03-实验                                             16 项        │
│   ▾ 📁 实验01                                            16 项    ⚖对照│
│     ▾ 📁 代码                                             6 项        │
│        ‹› battle.cpp      CPP                        654 B   📖 📂 🖥│ ← hover 才出现
│        ‹› solution_1.cpp  CPP                        573 B           │
│     ▾ 📁 报告                                             3 项        │
│        🖼 jietu.png        PNG                      107.9 KB          │
│        📄 report.md        MD                        24.0 KB          │
│        📕 report.pdf       PDF   读到 2/18            1.5 MB          │
│     ▸ 📁 测试数据                                         6 项        │
│ ▸ 📁 04-实验 …                                                        │
│ ▸ 🗄 99-归档（灰色，默认折叠）                                        │
└──────────────────────────────────────────────────────────────────────┘
```

- 层级靠 **左侧 1 px 引导线 + 每级 22px 缩进**表达，不画竖线网格。
- 目录头：`▸/▾` 是 SVG chevron（展开时旋转 90°），文件夹图标对普通/归档/空目录分色。
- 文件行：`图标(按类型着色) + 文件名 + 徽章(MD/PDF/CPP…) + 大小 + 操作区`；操作区默认 `opacity:0; translateX(4px)`，hover 或键盘 focus 时淡入。
- 归档目录：`.dir-block.archive` 灰显 + 名字后自动缀"归档"，且不计入作业统计。
- 空目录聚合：同一级空目录超过 3 个时，折叠成一行 `.empty-fold`（"另有 N 个空目录"），点开才展开列表。
- 作业目录行右侧出现 `⚖ 对照` 按钮（`[data-compare]`）→ `#/compare?dir=`。

### 5.5 PDF 阅读页（`#/read?path=...`）

```
┌──────────────────────────────────────────────────────────────────────┐ ← 深色工具条
│ ← 返回 │ report.pdf  ◀ [2] / 18 ▶ │ − 100% ＋ ⤢适宽 │ 🔍页内 3/12 ◀▶ │ 📂目录 🖥系统│
├──────────────────────────────────────────────────────────────────────┤
│                        （深灰底 #34363b）                             │
│                  ┌────────────────────────────┐                      │
│                  │                            │  ← .pdf-page 白纸    │
│                  │       PDF 页面 canvas      │     + 强阴影，居中   │
│                  │      （文字层可选中）      │                      │
│                  └────────────────────────────┘                      │
│                  ┌────────────────────────────┐                      │
│                  │           下一页…          │                      │
└──────────────────────────────────────────────────────────────────────┘
```

- 工具条是深色渐变，与白纸形成对比，减少阅读时的眩光。
- 连续滚动（不是单页翻页），页码输入框与滚动位置双向同步。
- 页内搜索条只在 full 模式出现；对照页的 pane 模式没有返回/搜索，只保留翻页与缩放。

### 5.6 文档阅读页（MD / DOCX / 代码 / 图片 / ZIP）

```
┌──────────────────────────────────────────────────────────────────────┐
│ ← 返回 │ report.md · 24.0 KB · Markdown              📂 目录  🖥 系统 │ ← .doc-toolbar
├──────────────────────────────────────────────────────────────────────┤
│                     ┌──────────────────────────┐                     │
│                     │  .md-view 最大 820px 居中│                     │
│                     │  h1/h2/h3、表格、代码块、│                     │
│                     │  KaTeX 公式、引用块      │  ← .doc-body 滚动   │
│                     └──────────────────────────┘                     │
└──────────────────────────────────────────────────────────────────────┘
```

各类型内部布局：

- **Markdown**：正文宽 820 px 居中，行高 1.78；`pre` 深色块；表格 `display:block; overflow-x:auto` 防溢出；公式居中块级可横向滚动。
- **DOCX**：`.docx-view`，顶部一条提示"复杂版式会被简化"。
- **代码**：`.code-view`，Prism 暗色主题 + 行号栏；超 200 KB 顶部 ` .truncate-banner`。
- **图片**：`.img-stage` 居中（缩放到适宽/1:1）+ 底部 `.img-gallery` 缩略图条（同目录其他图片，点击切换，当前项高亮）。
- **ZIP**：`.zip-view` 表格（名称 / 原始大小 / 压缩后），目录行灰显。
- **未知格式**：`.unknown-view` 居中卡片（大图标 + 文件名 + 原因说明 + 两个按钮）。

### 5.7 作业对照页（`#/compare?dir=...`）

```
┌──────────────────────────────────────────────────────────────────────┐
│ ← 返回 │ 作业01 · 题目/作答对照        [✓ 已完成] [✓ 同步滚动] [⇅ 上下排列]│
├───────────────────────────────┬──────────────────────────────────────┤
│ 题目 · 作业01-题目.pdf        │ 作答 · 作业01-作答.pdf               │ ← .pane-label
│ ◀ [1]/2 ▶ − 100% ＋ ⤢        │ ◀ [1]/3 ▶ − 100% ＋ ⤢                │ ← .pane-toolbar
├───────────────────────────────┼──────────────────────────────────────┤
│                               │                                      │
│        PDF 第 1 页            │        PDF 第 1 页                   │
│                               │                                      │
├───────────────────────────────┴──────────────────────────────────────┤
│ 未分类文件（2）  无"题目/作答/答案"角色标识，未强行配对              │
│  cls  homework.cls                        14 KB  未分类 · 点击单独打开 │
│  tex  作业01.tex                           5 KB  未分类 · 点击单独打开 │
└──────────────────────────────────────────────────────────────────────┘
```

- 主体是 `grid-template-columns: 1fr 1fr`；点"上下排列"加 `.vertical` 改成两行（窄窗口 <900px 自动切）。
- 每栏 = `.pane-label`（角色 · 文件名）+ `.pane-toolbar`（独立翻页缩放）+ `.pane-holder`（内容）。
- 缺失一侧显示 `.pane-empty`（📭 + "暂无题目/暂无作答"）。
- 工具栏三个开关：已完成（写 `completed[dirRel]`）、同步滚动、排列方向。

### 5.8 搜索页（`#/search?q=...`）

```
┌──────────────────────────────────────────────────────────────────────┐
│ 找到 12 个文件 · 87 处命中          索引：760 页 / 51 个文件  [重建索引]│
├──────────────────────────────────────────────────────────────────────┤
│ 📕 复变函数-课堂笔记大纲.pdf                             3 处命中 · 共 2 页│
│    复变函数/复变函数-课堂笔记大纲.pdf                                   │
│    第 3 页  … 由 Cauchy 积分公式可得 …                                 │
│    第 7 页  … Cauchy-Riemann 条件 …                                    │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.9 深色模式与响应式

- 深色：`@media (prefers-color-scheme: dark)` 整体覆盖令牌（style.css:688），不是简单反色；彩色徽章、进度条、代码块都有单独取值。
- 窄屏：`@media (max-width: 720px)`（style.css:724）——书架单列、顶栏收紧、课程页内边距减小、对照页自动上下排列。
- 动效：`@media (prefers-reduced-motion: reduce)` 关闭所有过渡与旋转。

### 5.10 交互清单

| 交互 | 行为 |
|---|---|
| `/` | 聚焦顶栏搜索框（输入态不劫持） |
| `Esc` | 清空搜索框并失焦 |
| `←` / `→` | PDF 阅读器翻页（焦点不在输入框时） |
| 卡片 `Enter`/`Space` | 进入课程 |
| 文件行 hover | 淡入"阅读/目录/系统打开"三个按钮 |
| 目录头点击 | 展开/折叠，状态写 `expandedDirs` |
| toast | 2.6 s 自动消失，右下/底部居中 |

---

## 6. 数据契约

### 6.1 `/api/tree`（节选）

```json
{
  "root": "大二",
  "generatedAt": "2026-11-02 12:33:21",
  "version": "P1.0",
  "stats": {"files": 103, "sizeBytes": 341835776, "sizeText": "326.0 MB", "courses": 9},
  "courses": [{
    "type": "dir", "name": "数据结构", "rel": "数据结构",
    "archive": false, "empty": false,
    "stats": {"fileCount": 20, "sizeBytes": 40160256, "pdfs": 3},
    "children": [
      {"type": "dir", "name": "03-实验", "rel": "数据结构/03-实验", "archive": false,
       "empty": false, "stats": {"fileCount": 16},
       "children": [
         {"type": "file", "name": "solution_1.cpp", "ext": "cpp", "size": 573,
          "rel": "数据结构/03-实验/实验01/代码/solution_1.cpp", "sizeText": "573 B"}
       ]}
    ]
  }],
  "rootFiles": [{"type": "file", "name": "_整理说明.md", "ext": "md", "size": 3277, "sizeText": "3.2 KB"}]
}
```

### 6.2 `/api/search`

```json
{
  "query": "Cauchy",
  "results": [{
    "rel": "复变函数/复变函数-课堂笔记大纲.pdf",
    "course": "复变函数",
    "name": "复变函数-课堂笔记大纲.pdf",
    "totalPages": 18,
    "hits": [
      {"page": 3, "snippet": "…由 Cauchy 积分公式可得…"},
      {"page": 3, "snippet": "…Cauchy-Riemann 条件…"}
    ]
  }],
  "totalFiles": 12,
  "totalHits": 87,
  "index": {"state": "ready", "indexed": 51, "total": 51, "pages": 760}
}
```

要点：`hits` 是**逐处命中**（同一页多次命中会有多条），每文件最多 `maxHits` 条（默认 50，上限 500）；`totalPages` 是该 PDF 的总页数，不是命中的页数。没有 pdftotext 时返回 `results: []` 且带 `message`，前端据此显示"未找到 pdftotext"。

---

## 7. 性能现状（可复现）

| 场景 | 数值 | 复现 |
|---|---|---|
| 目录树冷扫描（103 文件） | 108.5 ms（纯扫描 93.4 ms） | `python tests\probe_tree_cache.py` |
| 目录树热请求（缓存内） | 15.5–17.7 ms | 同上 |
| 目录树 `?fresh=1` | 107.7 ms | 同上 |
| 目录树 304 | 0 字节 body | 同上 |
| 树载荷 | 47 KB JSON | 同上 |
| 全文索引（51 PDF / 760 页） | 首次 31 ms 读缓存；重建约数秒 | `/api/index` |
| PDF 首屏 | 依赖懒渲染，只渲染视口附近 3–5 页 | — |

瓶颈排序：① 全量 `os.stat` 扫描（每次 90 ms 左右）；② PDF 页面 canvas 渲染（大页/高缩放时）；③ 索引重建（受 pdftotext 速度限制）。

---

## 8. 测试与验收体系

全部用 **CDP（Chrome DevTools Protocol）** 驱动真实浏览器，不用无头截图占位：

```
chrome --headless=new --remote-debugging-port=9333 --user-data-dir=%TEMP%\cr-dbg-profile
```

| 脚本 | 覆盖 | 结果 |
|---|---|---|
| `tests/cdp_p1.mjs` | 真实资料的 17 项：MD/KaTeX/DOCX/代码/图片/ZIP/对照/同步滚动/徽章/书架统计 | 17/17 PASS |
| `tests/cdp_adapt.mjs` | "未来新资料"样本 22 项：新课程、10 种代码语言、rar/tif 说明、坏 zip 不崩、md 对照、零异常 | 22/22 PASS |
| `tests/check_refresh.mjs` | 重新扫描按钮 + toast | PASS |
| `tests/probe_tree_cache.py` | 缓存/ETag/304/耗时 | PASS |
| `tests/make_fixture_adapt.py` | 生成样本目录 `tests/fixture_adapt/` | — |
| `tests/shot_pages.mjs` / `shot_dark.mjs` | 六页浅色 + 三页深色截图 | — |

跑测试的两个必备条件：

1. Chrome 必须以 `--remote-debugging-port` 启动，脚本连 `9333`（可用 `CDP_PORT` 改）。
2. **导航到相同 hash 的 URL 不会重载页面**——脚本里必须先 `about:blank` 再进目标页（或 `Page.reload({ignoreCache:true})`），否则测的是上一版 JS。

样本服务要独立端口与独立状态目录：

```
python server.py --no-browser --port 8766 --data-root tests\fixture_adapt --state-dir tests\fixture_state
```

---

## 9. 已知问题与优化清单

按"影响 × 改动成本"排序，每条给出定位与建议。

### 9.1 正确性（建议优先修）

| # | 问题 | 定位 | 建议 |
|---|---|---|---|
| 1 | **重启后目录展开状态丢失**：前端写 `expandedDirs`，后端 `load()` 白名单只保留 4 个键 | server.py:101–108 | 白名单加 `expandedDirs`（或改成"保留未知键但校验类型"） |
| 2 | 阅读器工具条仍用 emoji（`◀ ▶ ⤢ 📂 🖥`），与全站 SVG 图标体系不一致；不同系统字体下大小不一 | reader.js:113–157 | 复用 `#i-chev` 等 symbol，或新增 `i-play/i-fit/i-folder-open` |
| 3 | `@keyframes spin` 定义两次 | style.css:98 与 :646 | 删一处 |
| 4 | 全文搜索只覆盖 PDF；MD/DOCX/代码搜不到 | server.py:195 附近 | 见 9.2-1 |
| 5 | 作业目录只认 `作业/实验/小测` 前缀，`HW/Lab/Project` 不计入统计 | assignment.js:238 `courseAssignStats` | 前缀表抽成常量并放宽 |

### 9.2 功能扩展（用户价值高）

| # | 想法 | 落点 | 说明 |
|---|---|---|---|
| 1 | 把 MD/TXT/代码纳入全文索引 | `Indexer` 增加"纯文本文件直读"分支，复用同一份页级缓存结构 | 成本低、收益直接（笔记类资料大多是 md） |
| 2 | 书签/收藏 | `state.json` 加 `bookmarks: [{rel, page, note, ts}]`，阅读器工具条加 ☆ | 需要一处新 UI（侧栏或弹层） |
| 3 | 阅读进度总览页 | 新路由 `#/progress`，读 `state.progress` 按课程聚合 | 纯前端，数据已有 |
| 4 | 作业配对支持"多份作答" | `analyzeDir` 返回数组而非单值 | 现在是 1 对 1 |
| 5 | PDF 目录/大纲（outline）跳转 | `pdf.getOutline()` | pdf.js 已支持，成本低 |
| 6 | 打印/导出当前页 | `window.print()` + `@media print` | 样式需单独调 |

### 9.3 性能

| # | 问题 | 建议 |
|---|---|---|
| 1 | 每次冷扫描全量 `os.stat`（90 ms，随文件数线性增长） | 只 `stat` 目录 mtime，未变则复用子树缓存；或加文件监听（watchdog） |
| 2 | 大 PDF 缩放时全量重渲染 | 只重渲染视口附近页，其余只改 CSS 宽度 |
| 3 | 首页一次性渲染所有课程卡片 | 目前 9 门无感；若到几十门可加虚拟滚动 |
| 4 | 索引重建是串行 `pdftotext` | 可用线程池并行（注意 CPU） |

### 9.4 代码质量

- `reader.js` 558 行，`PdfViewer` 一个类承担了"视图 + 状态 + 搜索 + 手势"，可拆成 `PdfPages`（渲染/懒加载）与 `PdfChrome`（工具条/搜索）。
- `app.js` 同时是"工具库 + 路由 + 顶栏"，可拆 `api.js` / `state.js` / `router.js`。
- 视图之间仍靠 `G` 全局对象通信，若继续长大建议引入极简事件总线。
- **格式判定还有一处绕过 `formats.js`**：`reader.js:19` 用 `const ext = (node.ext || "").replace(/^\./, "").toLowerCase(); if (ext !== "pdf")` 决定走 PDF 还是文档页。行为正确（.pdf 只有一个），但违背"唯一真源"的约定，建议改成 `viewerKindFor(node.name) === "pdf"`。
- `tests/` 下有 20 多个阶段性调试脚本（`cdp_probe*.mjs` 等），可归档到 `tests/archive/`。

---

## 10. 扩展指南（常见改动的落点）

### 加一种文件格式

1. `js/formats.js` 的 `FORMATS` 加一行：`foo: T("code", "code", "foo", "")`。
2. 若要语法高亮：把 `prism-foo.min.js` 放进 `vendor/prismjs/`，在 `index.html` 的 Prism 脚本段按依赖顺序引入。
3. 若需要专门的渲染器：在 `js/viewers.js` 写一个 `FooViewer()`（实现 `mount/destroy`），并在 `createViewerFor` 加一个 case。
4. 不需要改 CSS——图标与徽章由 `group` 自动取色。

### 加一个页面

1. 在 `app.js` 的 `route()` 加一个 hash 分支；
2. 新模块导出 `renderXxx(main, ...)`，**返回 cleanup 函数**；
3. `setCrumb([...])` 设置面包屑；
4. 需要样式就加到 `css/style.css` 对应分区（保持分区注释）。

### 改视觉

只动 `:root` 令牌（style.css:6–47）即可整体换肤；深色模式在 style.css:688 单独覆盖。**不要**在组件里写死颜色，否则深色模式会漏。

### 加一个 API

1. `server.py` 写 `_api_xxx(self)`，用 `_send_json` 返回；
2. 在 `do_GET`/`do_POST` 的路由表加一行；
3. 前端在 `app.js` 里加一个 `export const getXxx = () => api("/api/xxx")`。

---

## 11. 关键决策记录（为什么这么做）

| 决策 | 原因 |
|---|---|
| 用 Python 标准库写 HTTP，不用 Flask/FastAPI | 目标机器可能没有 pip 环境；`python server.py` 双击即跑，零安装 |
| 前端不用框架、不打包 | 使用者不是前端工程师，改一行 CSS 应立刻可见；也避免了 node_modules 与构建链路 |
| 第三方库全部本地化 | 断网/校园网限制下仍可用；也避免 CDN 版本漂移 |
| 资料目录只读、状态写 `%LOCALAPPDATA%` | 资料在云盘同步目录里，任何写入都可能触发同步冲突 |
| 目录树每次全量扫描 + 2 s 缓存 | 比文件监听简单可靠（云盘目录的 inotify 不可靠），103 文件 90 ms 可接受 |
| 作业不自动猜配对 | 猜错比不猜更糟；未分类单独列出，让用户自己点 |
| 格式判定集中在 `formats.js` | 曾经 `viewers.js` 与 `library.js` 各存一份白名单，导致"列表显示能看、点开说不支持" |

---

## 12. 术语

| 词 | 含义 |
|---|---|
| 课程 | 资料根目录下的一级目录 |
| 作业目录 | 名字以 `作业/实验/小测` 开头、且含文件的目录（用于书架统计） |
| 配对 | 同一作业目录里"题目"与"作答"两个文件的对应关系 |
| 归档 | 路径中含 `99-` 前缀的目录，灰显、折叠、不计统计 |
| 空目录聚合 | 同级空目录超过 3 个时折叠成一行 |
| 稳定 ETag | 不含 `generatedAt` 的树内容哈希，保证 304 能命中 |
