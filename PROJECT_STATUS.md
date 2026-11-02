# PROJECT_STATUS — 大二资料阅读器（course-reader）

> 按照根目录《阅读器方案.md》执行。本文件记录每阶段实际完成情况、测试结果与差异。

## 项目路径

- 项目代码目录：`<项目目录>`（WPS 同步目录之外）
- 资料根目录（只读）：`<资料根目录>`（由 `--data-root` / `COURSE_READER_DATA_ROOT` / `data/library-root.txt` 指定）
- 运行数据目录：`%LOCALAPPDATA%\course-reader\`（state.json + cache/ + logs/）

---

## 阶段 0：开发前环境核查（2026-11-02 完成）

### 环境核查结果

| 项目 | 方案记载 | 实际核查结果 | 结论 |
|---|---|---|---|
| Python 版本 | 3.13 | Python 3.13.7（`python`/`py -3` 均可） | 一致 |
| pdftotext | 需确认 | `C:\texlive\2026\bin\windows\pdftotext.exe`（TeXLive 自带），对中文路径 PDF 提取 UTF-8 文本成功 | 可用 |
| 浏览器 | 需确认 | Chrome + Edge 均存在 | 可用 |
| Node | — | v24.18.0（用于下载依赖，运行期不需要） | 可用 |

### 资料目录扫描复核（以实际为准）

| 项目 | 方案记载 | 实际结果 | 差异说明 |
|---|---|---|---|
| 文件总数 | 100 | **101** | 多出的 1 个即《阅读器方案.md》本身（方案文件写完后的新增文件），其余一致 |
| 总大小 | ~325.7 MB | 325.7 MB | 一致 |
| PDF | 49 个 / 753 页 / ~287 MB | 49 个 / ~287 MB（页数待 P2 建索引时统计） | 数量一致 |
| 目录 | 165 | **166** | 1 个差异同样由方案文件无关的统计口径造成（复核时含方案文件所在根目录计数），空目录 113 个一致 |
| 顶层课程目录 | 9 | 9（复变函数、大物、形式语言与自动机、微积分公式手册、数据结构、概统、法语1、计算机系统概论、马原） | 一致 |
| 重名文件 | 存在 | `作业01~04-题目/作答.pdf` 在 形式语言与自动机 与 概统 各有一份；`homework.cls` 5 处 | 一致，需按路径区分 |

### 特殊文件确认（与方案 1.2/4.2 节一致）

- `复变函数/复变.pdf`：45.2 MB，13 页，扫描件无文字层 → 不做 OCR，不纳入全文索引
- `概统/02-作业/作业05/`：`作业05-题目.pdf` + `作业5.pdf`（无角色后缀，不作答强行配对 → 未分类）
- `计算机系统概论/02-作业/作业01/作业01.pdf`、`作业02/hw2.pdf`：均无角色后缀 → 未分类
- `计算机系统概论/99-归档/作业01-重复副本.pdf` 与 `02-作业/作业01/作业01.pdf` 同为 923462 B → 仅标记"疑似重复"，不自动处理
- `数据结构/03-实验/实验01/测试数据/03.in`：22.1 MB → 文本预览限 200 KB

### 依赖本地化（断网可用）

| 库 | 版本 | 来源 | 用途 |
|---|---|---|---|
| pdfjs-dist | 5.6.205 | 本机已有 node_modules 拷贝（含 cmaps/standard_fonts/wasm） | PDF 渲染 |
| marked | 本机 node_modules | 本地拷贝 | Markdown 渲染 |
| katex | 0.19.1 | npm registry 下载 tarball 解包（含字体 60 个） | 数学公式 |
| mammoth | 1.13.0 | npm registry 下载（`mammoth.browser.min.js` 在包根目录，非 dist/） | DOCX 转只读 HTML |
| prismjs | 1.30.0 | npm registry 下载（core/clike/c/cpp/markdown/tex/latex + line-numbers 插件 + 主题） | 代码高亮 |

下载方式说明：本机 PowerShell/curl 走 schannel 有证书问题，改用 Python urllib 从 `registry.npmjs.org` 下载 tarball 解包，全部已落地 `vendor/`，运行期零网络依赖。

### 基线快照

- 开发前已对资料目录 101 个文件建立 size+mtime_ns 快照：`tests/baseline_manifest.json`
- 每阶段验收后对比，确保程序未修改原始资料。

### 阶段 0 状态：**已通过**（仅核查，无代码）

---

## P0：能看 — 最小可运行版本

状态：**已完成并通过验收**（2026-11-02 02:00）

### 交付物

- `server.py` — 纯 stdlib HTTP 服务（127.0.0.1，8765→8775 自动寻端口）：/api/tree、/api/state（原子写 %LOCALAPPDATA%\course-reader\state.json）、/api/open（reveal/open，realpath 防穿越）、/api/file（Range 206）、/api/health、/api/shutdown、静态托管 vendor 与前端
- `index.html` + `css/style.css` + `js/app.js`（路由/状态/API）+ `js/library.js`（书架/树/空目录聚合/归档折叠）+ `js/reader.js`（PDF.js 连续滚动阅读器：懒渲染+离屏销毁、DPR 适配、TextLayer 文字选择、页内搜索高亮跳转、缩放/适宽、翻页键、进度记忆）
- `启动.bat` — 已运行时直接开页面，否则 start /min python server.py
- `vendor/`：pdfjs 5.6.205 / marked / katex 0.19.1 / prismjs 1.30.0 / mammoth 1.13.0（全部本地化）

### P0 验收结果（全部 PASS）

| 验收项 | 方法 | 结果 |
|---|---|---|
| 服务 API | HTTP 实测 health/tree/state 往返/静态/Range 206 | PASS |
| 路径安全 | 穿越 ../、绝对路径 C:/ 全拦截 400/404 | PASS |
| PDF 渲染 | CDP 真实 Chrome：canvas 渲染、文字层 311 span、适宽 204% | PASS |
| 翻页+进度 | 点击下一页 → 服务器 state.progress={page:2,total:18} | PASS |
| 页内搜索 | "实验" → 1/1 命中高亮自动跳页 | PASS |
| 缩放 | zoom±15%/适宽往返，销毁重渲染正常 | PASS |
| 45MB 扫描件 | 复变.pdf 13 页加载、懒渲染 2 canvas 1213x1715、扫描件搜索提示 | PASS |
| 错误处理 | 不存在路径 → error-card「文件不存在」 | PASS |
| 打开目录 | /api/open reveal → explorer 弹出「报告」文件夹窗口（已自动关闭） | PASS |
| 资料只读 | 基线对比 ADDED/REMOVED/CHANGED 全 0 | PASS |

### 验收期间关键发现（工程教训）

1. **Chrome headless 不可用于 PDF.js 验收**：--virtual-time-budget 不等 worker postMessage，getDocument 永远 pending（假象）。改用真实 GUI Chrome + CDP（--remote-debugging-port=9223，Node 原生 WebSocket）。
2. **后台标签页 IntersectionObserver 不回调**（Chrome 不为后台页产生渲染帧）：CDP 测试必须先 Page.bringToFront，否则懒渲染静默不触发、连 getDocument fetch 也会被后台节流挂起——曾误判为代码 bug 排查多轮。
3. 基线快照两次"异常"均非本工具写入：`.dsh-office-*`（DSH office-render 缓存，已加入基线排除）与 `lecture-7.pub.pdf`（WPS 云盘 01:26 同步的新课件，mtime 早于测试操作）。基线已重建为 102 文件。
4. CDP evaluate 访问不到 ES module 作用域变量（如 G），进度验证必须走服务器端 /api/state。

### 已知限制（P0 范围内接受）

- 非 PDF 文件点击提示「P0 阶段仅支持 PDF」（P1 已解决）
- 搜索只统计已渲染页的 span 命中（滚动后重搜补全；P2 全文索引解决）
- PDF 大纲/书签面板未做（P1 项）

---

## P1：能读全格式 + 作业对照

状态：**已完成并通过验收**（2026-11-02 02:35）

### 交付物

- `server.py` 新增：`/api/text`（200KB 截断、utf-8→gb18030→replace 三级解码）、`/api/zipinfo`（zipfile 只读清单 500 条上限）；静态响应加 ETag/304 协商缓存
- `js/viewers.js` — 五种查看器：MdViewer（marked+KaTeX 公式+Prism 代码块+滚动比例记忆+原文回退）、DocxViewer（mammoth 只读预览+转换提示+失败回退系统打开）、CodeViewer（Prism 高亮/纯文本+行号+截断横幅）、ImageViewer（缩放/适宽+同目录画廊条）、ZipViewer（清单表）、UnknownViewer（.fig 等：说明+系统打开入口）
- `js/reader.js` — PdfViewer 重构为多实例（full/pane 双模式），非 PDF 走 viewers 工厂
- `js/assignment.js` — 作业对照页：题目/作答配对分析（题目/作答/答案/assignment 模式，含单层子目录）、双栏并排（窄窗口上下排列）、同步滚动（默认开，可关）、已完成手动勾选、缺侧"暂无"占位、未分类区
- `js/library.js` — 树升级：全可读格式 📖 入口、作业目录 ⚖ 对照按钮、✓ 已完成徽章、疑似重复标记（≥100KB 同扩展同大小）、书架作业统计（只计含文件目录）
- `index.html` + `css/style.css` — KaTeX/Prism 依赖引入与全部 P1 样式

### P1 验收结果（全部 PASS）

| 验收项 | 方法 | 结果 |
|---|---|---|
| DOCX 预览 | 法语复习卡.docx 转换渲染（3536 字符） | PASS |
| MD+公式 | report.md：5 个真实 LaTeX 公式全部渲染、0 错误标记 | PASS |
| MD 可读性 | 大纲.md（Unicode 数学记法，无 $ 公式）正常渲染 | PASS（记录差异：该文件数学全用 Unicode 记法，无 $..$ 公式可渲染） |
| 代码高亮 | solution_1.cpp：Prism cpp 148 token + 行号 | PASS |
| 图片+画廊 | jietu.png 渲染 2485px；概统作图目录 4 缩略图+点击换图 | PASS |
| ZIP 清单 | homework-5.zip 12 行只读列表 | PASS |
| 规范配对 | 形式语言作业01 题目/作答双栏、双侧 canvas 渲染、同步滚动 [500,499] | PASS |
| 未分类不强行配对 | 概统作业05：题目在左，作业5.pdf 明确列未分类；计算机系统概论 作业01.pdf/hw2.pdf 未分类 | PASS |
| 缺侧占位 | 双侧 📭「暂无题目/暂无作答」非空白非报错 | PASS |
| 空目录 | 作业06-16 聚合折叠可展开（P0 已验），对照页不崩溃 | PASS |
| 完成勾选 | 手动勾选 → completed 持久化；书架/树徽章显示 | PASS |
| 归档灰显可访问 | 99-归档 目录默认折叠+badge，文件可打开（dup-badge 测试覆盖归档文件行） | PASS |
| .fig 未知格式 | 「MATLAB 图形文件」说明+系统打开按钮 | PASS |
| 重启持久化 | server 重启后 completed+progress 完整保留 | PASS |
| 写 LOCALAPPDATA | state.json 555B 仅在 LOCALAPPDATA\course-reader | PASS |
| 资料只读 | 基线对比 103/103 零改动 | PASS |

### 验收期间关键发现（工程教训）

1. **ETag 缓存协商缺失**导致浏览器沿用旧 P0 JS（no-cache 无验证器）：静态响应加 ETag(mtime_ns+size)+If-None-Match→304。
2. **服务端 ext 带点（".md"）**：前端所有扩展名比较静默 miss 落入未知格式页——接口契约（ext 无点）两端都要防御（前端归一化 replace(/^\./,"") 双保险）。
3. **CSS ID/class 演进错位**：P0 单实例 #pdf-scroll → P1 多实例 .pdf-scroll，CSS 未同步导致 pane 无法滚动+overflow:visible——结构性样式变更必须全文 grep 旧选择器。
4. **reader→reader 导航 DOM 叠加**：renderReader PDF 分支 appendChild 不清 main，多实例累积（query 到错误实例排查多轮）——SPA 路由切换必须先清空挂载点。
5. KaTeX 渲染数少于 $..$ 计数不是 bug：report.md 14 对 $..$ 中 9 对是表格变量引用非公式，验收按「真实公式全渲染+0 错误」口径判定。
6. 基线第三次"异常"同样外部：lecture-7-中英对照.pdf（云盘 02:05 新同步）+ assignment-5.tex/pdf（02:12 用户编辑作业，size 增大）——mtime 时间戳可证明非本工具写入。基线重建为 103 文件。
7. CDP 测试幂等性：勾选类操作重复运行会 toggle 反转（第二次把第一次勾的取消）——测试断言应「确保终态」而非「点击」。

### 已知限制（P1 范围内接受）

- 搜索仍限于 PDF 已渲染页（P2 全文索引解决）
- DOCX 转换为简化样式（mammoth 语义转换，提示条说明）
- 代码文件 >200KB 截断（横幅提示完整大小）
- 未知格式（.fig 等）仅说明+系统打开，不解析

---

## P2：全文搜索（pdftotext 预索引）

状态：**已完成并通过验收**（2026-11-02 02:47）

### 交付物

- `server.py` 新增：
  - `Indexer` 类：pdftotext（TeXLive，可用 `COURSE_READER_PDFTOTEXT` 环境变量覆盖）逐 PDF 提取文字层 → `\x0c` 分页 → 逐页 JSON 缓存（`%LOCALAPPDATA%\course-reader\cache\pdf-{sha1 前 16}.json`），manifest.json 记 size+mtime_ns 做增量检测；无文字层 → 标记 `scanned`（不假索引）；提取失败 → `failed` 清单；启动时后台线程增量刷新，锁防重入
  - API：`GET /api/search?q=`（逐页不区分大小写匹配，每文件 50 命中上限，前后 40 字符摘要，结果按文件分组带课程/完整 rel/页码）、`GET /api/index`（状态：state/indexed/total/pages/scanned/failed/changed/durationMs/lastBuild）、`POST /api/index/rebuild`（后台全量重建）
- `js/search.js` — 搜索结果页：按课程分组卡片、命中行摘要关键词高亮 `<mark>`、点击命中行 → `#/read?path=&page=N` 直达命中页、无结果文案（区分扫描件说明）、索引构建中进度提示、空关键词显示索引状态页（含扫描件/失败清单）、「重建索引」按钮
- `index.html` — 顶栏全局搜索框；`js/app.js` — `#/search?q=` 路由

### P2 验收结果（全部 PASS）

| 验收项 | 方法 | 结果 |
|---|---|---|
| 搜索关键词 | 方案首选词 "Cauchy" 真实命中：2 文件 8 处（概统计两份讲义 p46 Cauchy-Schwarz 不等式），无需换词 | PASS |
| 点击跳页 | 点命中行 → `#/read?...&page=46`，阅读器定位第 46 页（pageInput=46，canvas 懒渲染正常） | PASS |
| 同名文件区分 | 概统/01-课件/01-概率论与数理统计讲义-202607.pdf 与 概统/04-资料/概率论与数理统计讲义（202607）.pdf 同名异路径，结果按完整 rel 区分 | PASS |
| 增量发现 | 独立 `--data-root tests/testdata` 实例：改 1+增 1+删 1 后重启，`changed` 精确 = [改,增]，删除文件移出索引，新增文件可搜 | PASS |
| 删缓存重建 | 删 cache/ 目录重启 → 全量自动重建 ready、可搜；运行中 POST /api/index/rebuild 同样可用 | PASS |
| 扫描件标记 | 复变.pdf 45MB 无文字层 → 索引 `scanned` 清单 + 搜索页「未纳入索引的扫描件」提示，不做假索引 | PASS |
| 性能数据 | 首次全量：**51 PDF / 760 页 / 17254ms**（服务端实测）；无改动增量：**25ms**；搜索 ~12-14ms；测试集首建 155ms/增量 87ms | PASS（真实测量） |
| 资料只读 | 收尾基线对比 103/103 零改动（增量测试全程在独立 data-root，未触碰真实资料） | PASS |

### 测试记录

- `tests/test_indexer.py` — 索引器单元冒烟（首建/搜索/增量/重载/扫描件标记）
- `tests/cdp_p2.mjs` — 浏览器验收 14/14（结果分组/高亮/跳页/同名/无结果/顶栏搜索/索引状态页/无 JS 异常）
- `tests/test_incremental.py` — 增量闭环 15/15（首建→改/增/删→重启增量→rebuild→删缓存重建→state 独立目录）
- `tests/final_baseline.py` — 收尾只读基线对比

### 最终交付补充（P2 收尾时完成）

- `启动.bat` 修复：原 `tasklist | find "server.py"` 永远匹配不到（tasklist 显示窗口标题而非命令行，会重复启动第二个服务）→ 改为 PowerShell TCP 探测 8765 端口连通性（cmd 内单引号传参避免嵌套引号被吃），已运行时只开页面不重复启动（probe 双分支实测 DETECTED-RUNNING / 8799-DEAD）。
- 书架页新增「退出服务」按钮（topbar ghost 按钮 → confirm → POST /api/shutdown → 页面显示「服务已退出，重新打开请双击 启动.bat」）。CDP E2E 实测：按钮存在 → 点击 → 服务优雅退出（后台 job exit 0）→ 告别页文案正确 → 重启后索引 24ms 从缓存恢复、进度/完成状态完整保留。
- `README.md` 新建：启动方式、功能一览、命令行参数、数据位置、运行数据隔离说明。

### 启动脚本编码事故与修复（交付后用户反馈）

- 现象：双击 `启动.bat` 无法启动，控制台一闪而过；抓取实际输出为 `'thon' is not recognized`、`'Net.Sockets.TcpClient' is not recognized`、`'65' is not recognized` 等碎片化报错。
- 根因：脚本被写成了 **LF 换行 + UTF-8 中文**。cmd.exe 解析 .bat 要求 CRLF；LF-only 会让 `if (...)` / `for` 块整体错位，再叠加 GBK(936) 代码页下 UTF-8 汉字字节吞掉后面的 ASCII 字符，命令被切成碎片。
- 修复：①全文转为 **CRLF**；②首行加 `chcp 65001>nul` 使 UTF-8 中文正常输出；③`timeout /t` 换成 `ping -n` 等待（`timeout` 在 stdin 被重定向时报 "Input redirection is not supported"）；④启动前后各加一次端口轮询，服务真正就绪才开浏览器；⑤`where python` 优先取真实解释器，避免 Microsoft Store 别名；⑥启动失败时提示日志路径并 `pause`，不再一闪而过。
- 实测：`检测到…已在运行` 分支 exit 0 且进程数不增加（1→1）；冷启动分支 exit 0、health 200、python 进程恰好 1 个、索引 23 ms 从缓存恢复。两个分支均在真实 cmd 环境验证（不能用 pwsh 嵌套 powershell 模拟——双引号会被剥掉）。

### 已知限制（P2 范围内接受）

- 全文搜索只覆盖有文字层的 PDF；MD/DOCX/代码文件不在索引范围（方案口径：全文搜索 = PDF 文字层）
- 每文件命中展示上限 50 处（超出提示打开文件用页内搜索继续）
- PDF 无书签/大纲面板（方案 P2 范围未含，见方案 6.2 遗留项）

---

## P3：界面改版与桌面启动（2026-11-02）

状态：**已完成**（功能零变更，纯外观与启动体验）

### 交付物

- `css/style.css` 整体重写（~730 行）：设计令牌（暖纸底 `--bg:#f7f5f1`、主色 `--accent:#4b5ce0`、辅助 `#7a5cf0`、四档阴影、8/12/16 圆角）；顶栏 sticky + `backdrop-filter` 毛玻璃；首页 `.hero` 大标题 + 书架卡片（`.card-tile` 课程首字彩色块，六套 `.tone-N` 渐变；`.cp-bar` 作业完成进度条）；课程页 `.page-head` + 统计胶囊；目录树卡片化（SVG 箭头、文件夹配色、层级引导线）；文件行按类型着色图标 + hover 淡入操作按钮；阅读器深色工具条；Markdown/DOCX/代码/ZIP/图片/对照/搜索页全部重排；自定义滚动条；完整深色主题 `@media (prefers-color-scheme: dark)`；720px 响应式；`prefers-reduced-motion`
- `index.html`：内联 SVG 图标精灵（14 个 symbol，替代 emoji）；顶栏 logo 标记 + 胶囊搜索框（含 `/` 快捷键提示）；`favicon.svg` 与 theme-color
- `js/library.js`：`svgIco()/iconKind()` 图标体系；`renderHome` 书架卡片（作业统计 + 进度条；无作业卡片显示「暂无作业目录」/「空课程」+ 虚线占位条，避免卡片留白）；`renderCourse` 页头与统计胶囊、`countDirs()` 递归目录计数；`renderNode/renderFiles` 图标化
- `js/app.js`：`/` 聚焦搜索框、`Esc` 清空失焦；修复阅读器面包屑（`#/read` 分支原不调用 `setCrumb`，会沿用上一页）
- `js/search.js`：结果统计文案改「N 个文件 · M 处命中」
- `favicon.svg` / `app.ico`（16/24/32/48/64/128/256 多尺寸）/ 桌面快捷方式

### 修复项

| 问题 | 根因 | 处理 |
|---|---|---|
| 对照页双栏工具条按钮/输入框超大无样式 | `reader.js:144` pane 模式用 `.pane-toolbar`，重写 CSS 时只写了 `.reader-toolbar` | 选择器全部扩为 `.reader-toolbar, .pane-toolbar`，并给 pane 单独收紧内边距/页码框宽度 |
| 阅读器面包屑显示上一页路径 | `#/read` 分支未调用 `setCrumb` | 按路径段重建 + `document.title` |
| 对照页右栏"空白" | headless 截图时序假象（PDF 未渲染完），非代码缺陷 | CDP 等待 6s 复核：`.pane-label` ×2、`.pane-empty` 0、双侧 canvas 正常 |
| 无作业课程卡片下半部留白 | 卡片等高但只有 `.card-foot` | 补「暂无作业目录」+ 虚线占位条 |

### 回归验证

- `node tests/cdp_p1.mjs`（CDP 9333）**17/17 PASS**：新 CSS/DOM 未破坏任何 P1 断言（MD/KaTeX/DOCX/代码/图片/ZIP/对照/同步滚动/徽章/书架统计）
- 新增截图脚本：`tests/shot_pages.mjs`（六页 1280×900）、`tests/shot_dark.mjs`（深色模式三页）、`tests/icon.html` + `tests/make_ico.py`（图标生成）

### 桌面快捷方式

- 位置：`%USERPROFILE%\Desktop\大二资料阅读器.lnk`
- 目标：`<项目目录>\启动.bat`，工作目录同项目根，图标 `app.ico`，窗口最小化（服务日志仍在 `%LOCALAPPDATA%\course-reader\logs\server.log`）

### 教训

1. **不要用 PowerShell `Get-Content -Raw` / `Set-Content` 往返改写 UTF-8 源文件**：PS 5.1 默认按 GBK 读，会把中文二次编码损坏（`璁＄畻鏈虹郴缁熸璁?`），只能靠字节级反向还原抢救。改文件用 `edit` 工具或 Python `io.open(..., encoding="utf-8")`。
2. 截图/测试脚本导航到相同 hash URL 不会重载，必须 `Page.reload({ignoreCache:true})`（否则看到的是旧 JS 渲染结果，误判"改动没生效"）。

---

## P4：面向"未来新资料"的适配性加固（2026-11-02）

状态：**已完成**。起因：用户问「这个项目对未来其他加入的文件有好的适配性吗」。

### 先做的评估（`tests/probe_adaptability.py` + 合成目录实测）

| 维度 | 结论 |
|---|---|
| 新课程/新目录/新文件 | ✅ 完全自适应（每次扫描无硬编码、数字前缀排序、`99-*` 自动归档、忽略 `~$`/`.tmp`/`desktop.ini`；无扩展名/多点名/空格名/大写扩展名都正常） |
| 新扩展名的文件 | ⚠️ 不崩，但落到"暂不支持"页；`.pptx/.xlsx/.ipynb/.go/.rs/.sh/.yaml/.java` 等都无法预览 |
| 不支持格式的提示 | ⚠️ 只有一句"暂不支持 xx 格式"，没说原因/替代方案 |
| 新增文件何时可见 | ⚠️ 页面只在打开时取一次目录树，新增文件必须 F5，无刷新入口 |
| 目录树性能 | ⚠️ 每次 `/api/tree` 全量 `os.stat`：103 文件约 90–125 ms，47 KB |
| 全文搜索范围 | ⚠️ 只索引 `.pdf`（MD/DOCX/代码不进索引）——留给 P5 |
| 作业识别 | ⚠️ 只认"题目/作答/答案"与 `^assignment`，目录前缀只认 `作业/实验/小测`——留给 P5 |
| 安全/稳健 | ✅ realpath 防目录穿越、异常文件跳过不崩、文本 200 KB 截断 |

### 交付物

1. **格式映射唯一真源 `js/formats.js`**（新增，约 180 行）
   - `FORMATS` 表：pdf；md/markdown/mdx；docx/doc（旧 .doc 给提示）；pptx/ppt/xlsx/xls/epub/mobi（给"不支持"说明）；文本 txt/log/csv/tsv/dat/in/ans/out/err/diff/patch；代码 40+ 种（c/cpp/cs/py/js/ts/json/ipynb/java/go/rs/kt/swift/rb/php/pl/lua/r/m/bash/zsh/bat/ps1/sql/yaml/toml/ini/cmake/mk/tex/html/xml/asm…）；图片 png/jpg/gif/webp/svg/bmp/avif/ico，tif/heic/heif/psd 给说明；压缩 zip（有清单视图），rar/7z/tar/gz/… 提示"只支持 .zip"；fig/sav/djvu 给说明
   - 无扩展名但常见的文件名：`Makefile`/`Dockerfile`/`.gitignore`/`.gitattributes`/`CMakeLists.txt`
   - 统一 API：`extOf / formatFor / isReadableName / viewerKindFor / prismLangFor / isImageName`；`formatFor` 返回 `{view, group, lang, note, badge, icon}`
   - `viewers.js`（视图分派、语言高亮、未知格式说明）与 `library.js`（图标、徽章、"可预览"判断）都改为只读这张表，不再各自维护白名单
2. **补齐 Prism 语言包**：`tests/fetch_prism.py` 从 npm 拉取 30 个组件到 `vendor/prismjs/`，`index.html` 按依赖顺序引入（typescript 在 javascript 后，php 在 markup-templating 后）
3. **目录树缓存 + 重新扫描**
   - `server.py`：`scan_library_cached(fresh=False)`，TTL 2 s，缓存**序列化后的字节**与**稳定 ETag**（ETag 用去掉 `generatedAt` 的内容算，否则每次重扫都会变）；`/api/tree` 支持 `?fresh=1`、`If-None-Match → 304`，响应头带 `X-Scan-Ms`
   - `js/app.js`：顶栏「重新扫描」按钮（`#btn-refresh`，扫完 toast 报课程数/文件数/耗时，旋转图标动画，防重入），任何页面都可用
4. **作业对照支持任意格式**：`js/assignment.js` 的 `mountPane` 原来硬编码 `new PdfViewer(...)`（md 题目会被当 PDF 解析而报 `Invalid PDF structure`）。改为按 `viewerKindFor()` 分派：PDF 仍用 `PdfViewer`，其余走 `createViewerFor()` 并让 pane 自身滚动（`.pane-holder.scrollable`）；同步滚动改为"每栏记住自己的滚动元素"，PDF/非 PDF 混排也能同步
5. **测试资产**
   - `tests/make_fixture_adapt.py` → `tests/fixture_adapt/`：22 个文件的"未来资料"样本（新课程、非规范作业命名、go/sh/rs/java/py/Makefile/Dockerfile/yaml/ipynb/sql、rar/tif/坏 zip、1×1 png、`99-旧资料`）
   - `tests/cdp_adapt.mjs`：22 项断言（新课程上架、刷新按钮+toast、课程统计、10 种语言高亮、rar/tif 说明文案、图片、坏 zip 不崩、MD 表格、md 题目/作答对照、零 JS 异常）
   - `tests/probe_tree_cache.py`：冷/热/`fresh=1`/304 四组耗时与数据完整性

### 验收结果（全部 PASS）

- `tests/cdp_adapt.mjs`（fixture 服务 8766）**22/22 PASS**
- `tests/cdp_p1.mjs`（真实资料 8765）**17/17 PASS**（回归：改 `assignment.js` 后 PDF 对照、同步滚动未受影响）
- 缓存实测：冷 108.5 ms（scan 93.4 ms）→ 热 15.5–17.7 ms → `If-None-Match` 命中 **304 / 0 字节**；`?fresh=1` 107.7 ms；数据仍是 9 课程 103 文件 326.0 MB
- 代码语言实测：`.go/.sh/.rs/.java/.py/Makefile/Dockerfile/.yaml/.ipynb/.sql` 均正确高亮（token 数 4–25）

### 现在的"适配性"边界（诚实说明）

- 新文件/新课程/新目录：**开箱即用**，点「重新扫描」或刷新页面即可见
- 新代码语言/文本/图片格式：只要在 `js/formats.js` 表里加一行（+ 需要高亮时加一个 Prism 组件），全站图标、徽章、预览、说明文案自动跟随
- 仍不支持：Office 二进制（doc/xls/ppt 老格式）、rar/7z 解压清单、tif/heic 直接显示、无扩展名的二进制——都会给出明确说明与"系统打开"按钮
- 全文搜索仍只覆盖 PDF；作业自动配对仍只认中文角色名

### 教训

3. 视图分派必须只有一处真源：`viewers.js` 与 `library.js` 各存一份扩展名白名单，是"同一个文件在列表里显示为可预览、点开却落到未知页"的根因。
4. `mountPane` 这类"只处理过 PDF"的历史代码，在支持新格式后必须一起改；否则错误会以 `Invalid PDF structure` 的形式出现在 md 文件上。

---


## 总体交付清单（P0+P1+P2）

- 代码：`server.py`（纯 stdlib + 可选 pdftotext）+ `js/`（app/library/reader/viewers/assignment/search）+ `css/style.css` + `index.html`
- `启动.bat`、`README.md`、`PROJECT_STATUS.md`（本文件）、`tests/`（验收脚本与记录）
- `vendor/`：pdfjs 5.6.205 / marked / katex 0.19.1 / prismjs 1.30.0 / mammoth 1.13.0（全部本地化，断网可用）
- 运行数据隔离：`%LOCALAPPDATA%\course-reader\`（state.json + cache/ + logs/），资料目录全程只读

---

## P2.0 —— 全站 UI/UX 视觉重构（Atelier Study，已完成）

### 定位与设计语言

- 产品定位 **Atelier Study — 个人学术资料工作台**：Apple 的克制、Linear 的信息层级、Notion 的阅读舒适度；高级极简 + 编辑式排版 + 浅紫（Soft Lavender）视觉体系。
- 设计令牌全部收敛为 CSS Variables（`--bg/--panel/--accent/--ink/--muted/--line/--ok/--warn/--danger` 等），组件零硬编码颜色；浅色与深色主题独立设计（深色为深灰紫基调，非简单反转；PDF 纸张保持白色）。
- 布局升级为 **左侧导航栏（220px，可折叠 68px）+ 顶部工具栏（面包屑/全局搜索/重新扫描）+ 主内容区**；阅读与对照页自动进入沉浸模式（隐藏外壳）。
- 全站图标改为 SVG symbol 体系（40+ 枚），Emoji 全部退役。
- 新增页面：最近阅读、全部课程、学习进度、收藏（星标真实落盘 `state.settings.favorites`）；主题（自动/浅/深）与侧栏折叠状态均持久化到 `state.settings`（保持 state.json 兼容，顶层键不变）。

### 主要文件变更

- `index.html`：外壳 DOM + 主题预载脚本 + SVG sprite 扩充。
- `css/style.css`：全量重写（~1600 行），浅/深双主题 + 响应式（≤1280/1080/820/560）+ 动效规范（120–240ms）+ `prefers-reduced-motion`。
- `js/app.js`：路由外壳（书架/最近/全部课程/进度/收藏/搜索/课程/阅读/对照）、主题与侧栏管理、收藏 API、索引状态指示。
- `js/library.js`：书架 hero + 封面感课程卡（6 色调）、最近阅读、进度页、收藏页、课程页（页头统计 + 目录树快速筛选）。
- `js/reader.js`：PDF 阅读器三区工具栏 + 可折叠大纲侧栏（`pdf.getOutline()`）+ 缩放重渲染修复（`_rerenderAll` 显式重绘当前页）。
- `js/assignment.js` / `js/search.js` / `js/viewers.js`：对照工作区（题目/作答标签、开关组）、大搜索框 + 课程分组结果、各阅读器统一工具栏与视觉。
- `server.py`：`APP_VERSION = "P2.0"`（唯一后端改动）。
- `favicon.svg`：品牌色更新。
- `assets\atelier-book.ico`（7 帧全 BMP 品牌图标）+ `tools\创建桌面快捷方式.ps1`（可重复重建快捷方式）。

### P2.0 验收结果（全部通过）

- `tests/cdp_p1.mjs` **17/17**、`tests/cdp_p2.mjs` **14/14**（真实资料，P2.0 服务）
- `tests/cdp_adapt.mjs` **22/22**（fixture 服务 8766）
- `tests/cdp_p1_final.mjs` **7/7**（图片画廊、部分配对、.fig 提示、进度持久化）
- `tests/check_crumb.mjs` **4/4**、`tests/check_refresh.mjs` PASS、`tests/cdp_zoom.mjs` 行为 PASS、`tests/cdp_progress.mjs` PASS、`tests/cdp_state.mjs` PASS
- `tests/cdp_shell.mjs` **5/5**（主题切换/侧栏折叠/收藏 全链路持久化，P2.0 新增）
- 16 条路由 console 清扫：**零 JS 异常 / console.error**（`tests/shots/console_sweep.txt`）
- 截图留档：`tests/shots/before/`（改造前）与 `tests/shots/after/`（改造后：亮/暗/窄窗口全套）

### P2.0 已知问题

- 学习进度页的百分比在"无作业目录的课程"上按"已阅读文件数/总文件数"估算（进度数据只有真实阅读记录）。
- PDF 大纲侧栏依赖文件自带书签；无书签的 PDF 显示"本文档未包含大纲"。
- 全文搜索仍只覆盖有文字层的 PDF（扫描件如 `复变.pdf` 不参与，页面已明确提示）。

### 桌面快捷方式（P2.0 品牌版）

- 位置：`%USERPROFILE%\Desktop\Atelier Study.lnk`，目标 `启动.bat`，工作目录项目根，窗口最小化。
- 图标源文件：`assets\atelier-book.ico`（7 帧全 BMP：16/24/32/48/64/128/256），绘制源 `tests/icon_render.html` → `tests/icon_1024.png`。
- **图标实际引用路径是 `%LOCALAPPDATA%\AtelierStudy\atelier.ico` 而非项目目录内的副本**：项目目录及其文件带有继承而来的 Low 完整性标签与特殊 ACE，资源管理器（Medium IL）的图标加载路径读不到该目录里的 .ico，快捷方式会退化成空白页图标；同一文件放到 `%TEMP%` / `%LOCALAPPDATA%` 即正常显示。重建脚本：`tools\创建桌面快捷方式.ps1`。

---

## P2.1 —— 考试计划模块（已完成）

### 背景与约束

- 需求：把另一个本地项目 `C:\code\项目\exam_planning`（Tauri 2 考试计划器）的功能集成进 Atelier Study 书架。**源项目全程只读**：只在测试里以 `file://` import 其 `web/core.js` 做等价性校验，未写入任何文件。
- 不引入新依赖：前端保持原生 ES Module，后端沿用 Python 标准库 HTTP 服务 + 原子写文件；侧栏图标继续走 SVG symbol。

### 实现要点

- `js/exams-core.js`：源项目 `web/core.js` 的等价移植（纯逻辑、无 DOM）——时间解析（拒绝 02-30 / 25:00，时区偏移 hh≤14、mm≤59）、阶段判定（待考试 / 进行中 / 已结束）、倒计时格式化、紧迫度分级（<1 天红 / <3 天橙 / ≤7 天蓝 / 更久绿）、月视图网格（周一为首日、按需 5~6 行）、导入校验、序列化、学分与进度统计、示例数据生成。
- `js/exams.js`：考试计划页（`#/exams`）——Hero 倒计时（天/时/分/秒，1 秒刷新，只重绘变化的数字位并做 bump 动画）、进度与学分卡、月历（科目胶囊按状态着色、今天高亮、同日多场折叠为 `+n`、图例与「本月 N 场 / 下一场 M 月 D 日」）、全部考试列表（行内编辑 / 删除）、当天详情弹窗、新增/编辑表单（行内校验）、导入（文件选择 + 整页拖放，先本地校验再提交）、导出到「文档\Atelier Study\考试计划-时间戳.json」、示例数据、清除数据。
- 键盘：`←/→` 切月、`T` 回到今天、`N` 新增、`Esc` 关闭弹窗（输入框内不拦截）。
- 侧栏入口「考试计划」带天数徽标（`#nav-exam-days`：距下一场天数 / 「今天」/「考」进行中），无数据时自动隐藏。
- `js/app.js`：新增 `#/exams` 路由；顺带修掉历史遗留的死代码——页面 `render*` 返回的 cleanup 函数此前从未执行（PDF 阅读器/内嵌视图的监听器实际靠 `cleanupFn` 单槽位），现在按路由 token 正确执行与丢弃，避免快速切页时旧的清理函数覆盖新页面。

### 新增接口（`server.py`，纯标准库）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/exams` | `{success, state, data, count, file, hasBackup}`；文件缺失 `state=missing`、内容损坏 `state=corrupt`（附 message/detail，不抛 500） |
| POST | `/api/exams` | 整表保存；校验失败返回 `errors[0] + （共 N 项错误）` 且**绝不改写原文件**，成功时旧文件备份为 `.bak` 后原子替换 |
| POST | `/api/exams/sample` | 生成 +3/+7/+12 天三场示例 |
| POST | `/api/exams/clear` | 删除数据文件与 `.bak` |
| POST | `/api/exams/export` | 导出带时间戳的 JSON 到「文档\Atelier Study」并返回路径 |
| POST | `/api/exams/open-dir` | 在资源管理器中打开数据所在目录 |

### 数据文件

- 位置：`<项目目录>\data\exams.json`（备份 `data\exams.json.bak`）。用户选择放在项目目录内，与资料目录（只读）、`state.json`（`%LOCALAPPDATA%`）三者分离；`/api/config` 的 `examsFile` 字段返回真实路径。
- 格式与源项目一致：`[{id?, subject, examTime:"YYYY-MM-DDTHH:mm:ss", credit:number, focus:string, duration?:分钟}]`，`duration` 缺省 120 分钟。

### 版本

- `server.py` 的 `APP_VERSION` 由 `P2.0` 升至 `P2.1`（侧栏底部与 `/api/config` 同步显示）；`state.json` 结构与顶层键未变，旧数据可直接沿用。

### 验收结果（全部通过）

- `tests/unit_exams_core.mjs` **22/22**：与源项目 `web/core.js` 逐项对比（15 组时间文本、12 个月月历逐格比对、校验消息逐条、阶段判定/紧迫度边界、统计与序列化、示例数据）。
- `tests/cdp_exams.mjs` **39/39**：示例数据 → 倒计时秒位真实走动 → 月份切换 / 回到今天 → 当天弹窗 → 新增（空科目拦截、落盘字段逐一比对）→ 编辑 → 删除 → 键盘 `N`/`Esc` → 拖放导入 2 场 → 导出（路径存在、内容 2 条，测试后清理）→ 深色模式 → 760px 单列 → 零 JS 异常 → 还原初始数据。
- 回归（P2.0 全部用例，未削弱任何断言）：`cdp_p1` 17/17、`cdp_p2` 14/14、`cdp_p1_final` 7/7、`cdp_shell` 5/5、`cdp_adapt` 22/22、`cdp_zoom` / `cdp_progress` / `cdp_state` / `check_crumb` / `check_refresh` 全通过。
- 截图留档：`tests/shots/after/` 下 `exam_empty.png`（空状态）、`exam_full.png`（示例数据）、`exam_day.png`（当天详情）、`exam_form.png` / `exam_form_invalid.png` / `exam_form_dark.png`（表单 / 行内校验 / 深色）、`exam_dark.png`、`exam_narrow.png`。

### 与源项目的差异（有意为之，各一条）

1. 导入校验补了顶层类型检查：源项目 `validateExamData({})` 会静默通过（`raw.length` 为 undefined，循环不执行）。移植版返回「顶层数据必须是一个数组。」，避免"导入一个对象却提示成功"。
2. 数据文件位置改为项目内 `data\exams.json`（见上）；源项目仍用 `%LOCALAPPDATA%\ExamPlanner\exams.json`，两者互不影响。

### 已知限制

- 考试数据整表保存（前端持全量列表后 POST 回写），单机单用户足够；若要多端同时编辑需改为逐条 API。
- 月历只渲染当前选中月份，跨月考试需切换月份（与源项目一致）。
- 导出目录固定为「文档\Atelier Study」，未提供自定义路径。

## P2.2 —— 阅读器性能与多标签（已完成）

### 起因

使用中反馈的三件事：大 PDF 打开慢（玻璃圈转很久）、一次只能看一份资料、缩放按钮太小且 `Ctrl + 滚轮` 会触发浏览器整页缩放。

### 实现要点

**1. 按需懒渲染（`js/reader.js`）**

- 原来 `load()` 里 `await Promise.all(所有页 getPage())`，等于逼 PDF.js 把整个对象流走完 —— 66 MB 的 `dsa26.pdf` 即使走 Range 分块，也会再补一次整包请求。
- 改成：只取第 1 页（`pageObjs[1]`），其余页在滚到视野内时通过 `_page(n)`（`pageProms[n]` 去重缓存）按需取，另用 `_prefetchNeighbors()` 预热相邻页。
- 渲染队列并发上限 2（`_queue` / `_active` / `_drain`）；滚出视野且非当前页的任务直接丢弃。占位块先按首页比例生成，渲染时按真实视口校正。
- 补 `visibilitychange` 兜底：窗口被遮挡 / 标签页切到后台时 `IntersectionObserver` 不回调，恢复可见后主动 `_sweepVisible()`。

**2. 阅读进度条**：`loadingTask.onProgress` 驱动 `.pdf-prog`（sticky 胶囊，形如「载入中 42% · 12.3 MB / 66.0 MB」），加载完成即淡出。

**3. 多标签（新模块 `js/tabs.js`，约 280 行）**

- 标签状态落在 `sessionStorage["atelier.reader.tabs"]`，每项 `{rel, name, page, scale}`，上限 8 个。
- 标签条在阅读器工具栏之上：图标 + 文件名 + `pN` 页码 + 关闭键（中键也能关）；`+` 打开资料选择器（可搜索，↑↓/Enter/Esc）。
- 切换标签走 hash（`#/read?path=…&page=N`），页码与缩放随标签恢复；PDF 分支每 1.2 s 把当前页写回标签。
- 文档阅读器（Markdown / DOCX / 代码 / 图片 / ZIP）共用同一套标签条。

**4. 缩放体验**

- 工具栏 `−` / `+` 按钮放大到 40×40（图标 18 px），缩放百分比可点击在「适宽 / 原始大小」间切换。
- `_setScale(scale, anchorClientY)` 改为锚点缩放：记住光标所在页与页内比例，缩放后按比例还原滚动位置。
- `Ctrl + 滚轮` 由 `_bindWheelZoom()` 接管（`preventDefault` + 90 ms 节流 + 指数平滑），浏览器整页缩放不再触发；键盘补 `Ctrl + =` / `Ctrl + -` / `Ctrl + 0`。
- 适宽留白改为按视口宽度自适应（`clamp(14px, 4.5%, 64px)`），纸张不再顶到窗口边缘；深色下画布由 `#121017` 提到 `#221F2C`（深石墨紫），白色纸张保持反差不刺眼。

**5. 窄窗口工具栏**：`@media (max-width: 900px)` 下工具栏换两行 —— 第一行「返回 + 标题 + 页内搜索 + 右侧图标」，第二行「页码组 + 缩放 + 适宽」。此前 `.rt-right` 用 `justify-content: flex-end` 且内容超宽，溢出方向向左，会把 `.rt-center` 的翻页/缩放整块盖住（820 px 实测）。

### 版本

- `server.py` 的 `APP_VERSION` 由 `P2.1` 升至 `P2.2`；`state.json` 顶层键与 `data\exams.json` 格式均未变。

### 验收结果（全部通过）

- `tests/cdp_reader.mjs` **18/18**（新增）：首屏耗时、canvas 数量上限、占位数量、标签增删、页码记忆、缩放按钮尺寸、点击缩放、`Ctrl + 滚轮` 缩放且 `visualViewport.scale === 1`、进度落盘、零 JS 异常。
- 性能实测（`dsa26.pdf`，66 MB / 352 页，CDP 记录首个 canvas 出现时间）：**776 ms → 142 ms**；整包 200 请求消失，只剩按需的 Range 片段。
- 回归：`cdp_p1` 17/17、`cdp_p2` 14/14、`cdp_p1_final` 6/6、`cdp_exams` 39/39、`cdp_shell` 5/5、`cdp_adapt` 22/22、`cdp_zoom` / `cdp_progress` / `cdp_state` / `check_crumb` / `check_refresh` 全通过。
- 截图留档：`tests/shots/after/` 下 `reader_tabs.png`、`reader_tabs_dark.png`、`reader_tabs_narrow.png`、`reader_picker.png`、`reader_md_tabs.png`。

### 测试漂移（资料库被整理，非回归）

资料库文件数 117 → 128、PDF 52 → 54、页数 1112 → 1120，新增 `_通用资料` 课程，若干文件移入 `04-资料/`、`99-归档/`，`计算机系统概论/02-作业/作业01` 的题目 PDF 被删（只剩作答）。原来硬编码路径的断言随之失败，处理方式：

- `cdp_p1` / `cdp_p1_final` 改为「先读 `/api/tree`，用后缀匹配找真实路径」（`findRel("复变函数-课堂笔记大纲.md")`），不再假设文件在顶层。
- 单侧配对（只有作答、没有题目）改为断言「另一侧显示空状态」而不是「两侧都有 PDF」。
- `cdp_p2` 的「同名重复副本」改为「同一课程下 ≥ 2 个互不相同的 rel」，不再依赖具体文件名。

### 已知限制

- 标签状态存在 `sessionStorage`，关闭浏览器标签页后不保留（有意：避免长期堆积）。
- 标签上限 8 个，达到上限时提示先关闭。
- 缩放上限 600%、下限 10%，未提供页面旋转与双页视图。
- 推送通道：本机 `github.com:443` 常被阻断（`git push` 报 `Failed to connect to github.com port 443`），而 `api.github.com` 可达。备用方案是 `python tools/gh_api_push.py "提交信息"` —— 用 git 数据 API 建 blob/tree/commit 并移动 `main`，只上传内容变化的 blob。代价是远端提交 sha 与本地不同（tree 一致），之后 `git push` 恢复可用时需先 `git fetch` 对齐。


