# tests —— 验收脚本

所有 `cdp_*.mjs` / `check_*.mjs` 脚本都通过 **CDP 驱动真实 Chrome**（`http://127.0.0.1:<CDP_PORT>/json/list`），
不是 jsdom 模拟：它们验证的是真实渲染、真实滚动、真实 PDF 懒加载。

## 前置条件

1. **服务在跑**：`python server.py --no-browser`（默认 8765）
2. **调试用 Chrome 在跑**（脚本默认连 9333）：

   ```bat
   chrome --remote-debugging-port=9333 --user-data-dir=%TEMP%\cr-dbg-profile ^
          --window-size=1280,900 --disable-features=CalculateNativeWinOcclusion
   ```

   > `--disable-features=CalculateNativeWinOcclusion` 不是可选项：窗口被判定为遮挡/最小化时，
   > Chrome 不再触发 `IntersectionObserver`，PDF 懒渲染的 canvas 永远是 0 —— 会误报成 bug。

3. 端口可用 `CDP_PORT` 覆盖，服务地址在脚本头部常量里。

## 脚本一览

| 脚本 | 断言数 | 覆盖内容 |
|---|---|---|
| `cdp_p1.mjs` | 17 | Markdown + KaTeX、DOCX、代码高亮、图片画廊、ZIP、作业对照（完整/部分/未分类）、同步滚动、完成状态、重复标记 |
| `cdp_p2.mjs` | 14 | 全文搜索：命中卡片、摘要高亮、点结果跳转到命中页、空结果提示、扫描件提示、顶栏搜索框回车 |
| `cdp_exams.mjs` | 39 | 考试计划：渲染、秒级倒计时、切月/今天、当天弹窗、新增校验、编辑、删除、导入、导出、深色、760px 窄窗 |
| `cdp_shell.mjs` | 5 | 外壳：主题切换落盘、侧栏折叠、收藏写入 / 收藏页 / 取消收藏 |
| `cdp_adapt.mjs` | 22 | 格式适配性（需另起 fixture 服务，见下） |
| `cdp_zoom.mjs` | — | 缩放：适宽 → 放大 → 滚动后 canvas 仍存在 |
| `cdp_progress.mjs` | — | 翻页后进度写入服务端 `/api/state` |
| `cdp_state.mjs` | — | 通过 `window.G` 读本地状态并与服务端状态比对 |
| `cdp_p1_final.mjs` | 7 | 图片画廊点击切换、部分配对、未支持格式提示、完成状态持久化 |
| `check_crumb.mjs` | 4 | 阅读器 / 课程页面包屑，含"课程不存在"时仍保留导航位置 |
| `check_refresh.mjs` | — | 顶栏「重新扫描」：卡片数不变、toast 文案、busy 状态复原 |
| `unit_exams_core.mjs` | 17+ | 考试纯逻辑单元测试（时间解析、阶段、紧迫度、月历、校验、统计）。仓库内不含原项目时自动跳过等价性对比 |
| `shot_url.mjs` | — | 通用单页截图：`--url= --out= --w= --h= --theme=dark --wait=` |
| `shot_pages.mjs` / `shot_narrow.mjs` / `shot_dark.mjs` | — | 批量截图（书架/课程/阅读/对照/搜索；窄窗；深色） |

## 适配性夹具（cdp_adapt）

```bash
python tests/make_fixture_adapt.py     # 生成 tests/fixture_adapt（各种"未来可能遇到"的文件）
python server.py --no-browser --port 8766 --data-root tests/fixture_adapt --state-dir tests/fixture_state
node tests/cdp_adapt.mjs               # 默认连 9333 的 Chrome
```

## 其他工具

```bash
python tests/probe_tree_cache.py   # 目录树缓存 / ETag / 304 实测
python tests/probe_exams.py        # 考试数据解析与校验冒烟（服务端规则）
```
