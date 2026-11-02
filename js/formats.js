/* formats.js — 扩展名 → 分类 / 图标 / 徽章 / 预览方式 的唯一真源
 *
 * 新增一种格式只需在这里加一行：
 *     xyz: T("code", "code", "python")
 * 图标、文件名后的彩色徽章、文件行是否出现「阅读」入口、用哪个查看器、
 * Prism 高亮语言，全部自动跟随（library.js / viewers.js 都从这里取）。
 *
 *   view : pdf | md | docx | code | image | zip | none(交给系统程序)
 *   group: pdf | doc | md | text | code | image | zip | other —— 决定图标与徽章配色
 *   lang : Prism 语言名，none = 纯文本（不做高亮，也不报"语言未加载"）
 *   note : 不能预览时的具体说明（UnknownViewer 原样展示）
 */

export const GROUP_STYLE = {
  pdf:   { icon: "i-pdf",   badge: "pdf"  },
  doc:   { icon: "i-doc",   badge: "doc"  },
  md:    { icon: "i-doc",   badge: "md"   },
  text:  { icon: "i-code",  badge: "code" },
  code:  { icon: "i-code",  badge: "code" },
  image: { icon: "i-image", badge: "img"  },
  zip:   { icon: "i-zip",   badge: "zip"  },
  other: { icon: "i-page",  badge: null   },
};

const T = (view, group, lang = "none", note = "") => ({ view, group, lang, note });

export const FORMATS = {
  /* ---------- 文档 ---------- */
  pdf:      T("pdf", "pdf"),
  md:       T("md", "md"),
  markdown: T("md", "md"),
  mdx:      T("md", "md"),
  docx:     T("docx", "doc"),
  doc:      T("none", "doc", "none",
              "旧版 .doc 二进制格式，无法在浏览器内转换；请用 Word 另存为 .docx，或点「系统打开」。"),
  pptx:     T("none", "doc", "none",
              ".pptx 暂不支持预览（需 Office 转换）；点「系统打开」用 PowerPoint / WPS 查看。"),
  ppt:      T("none", "doc", "none", "旧版 .ppt 暂不支持预览；点「系统打开」用 PowerPoint / WPS 查看。"),
  xlsx:     T("none", "doc", "none",
              ".xlsx 暂不支持预览（需 Office 转换）；点「系统打开」用 Excel / WPS 查看。"),
  xls:      T("none", "doc", "none", "旧版 .xls 暂不支持预览；点「系统打开」用 Excel / WPS 查看。"),
  epub:     T("none", "doc", "none", "EPUB 不在支持列表；点「系统打开」用电子书阅读器打开。"),
  mobi:     T("none", "doc", "none", "MOBI 不在支持列表；点「系统打开」用电子书阅读器打开。"),

  /* ---------- 纯文本 ---------- */
  txt:  T("code", "text"),
  log:  T("code", "text"),
  csv:  T("code", "text"),
  tsv:  T("code", "text"),
  dat:  T("code", "text"),
  in:   T("code", "text"),
  ans:  T("code", "text"),
  out:  T("code", "text"),
  err:  T("code", "text"),
  diff: T("code", "text", "diff"),
  patch:T("code", "text", "diff"),

  /* ---------- 代码 ---------- */
  c:      T("code", "code", "c"),
  h:      T("code", "code", "c"),
  cpp:    T("code", "code", "cpp"),
  cxx:    T("code", "code", "cpp"),
  cc:     T("code", "code", "cpp"),
  hpp:    T("code", "code", "cpp"),
  cs:     T("code", "code", "csharp"),
  py:     T("code", "code", "python"),
  pyw:    T("code", "code", "python"),
  js:     T("code", "code", "javascript"),
  mjs:    T("code", "code", "javascript"),
  cjs:    T("code", "code", "javascript"),
  jsx:    T("code", "code", "javascript"),
  ts:     T("code", "code", "typescript"),
  tsx:    T("code", "code", "typescript"),
  json:   T("code", "code", "json"),
  ipynb:  T("code", "code", "json"),
  java:   T("code", "code", "java"),
  go:     T("code", "code", "go"),
  rs:     T("code", "code", "rust"),
  kt:     T("code", "code", "kotlin"),
  kts:    T("code", "code", "kotlin"),
  swift:  T("code", "code", "swift"),
  rb:     T("code", "code", "ruby"),
  php:    T("code", "code", "php"),
  pl:     T("code", "code", "perl"),
  pm:     T("code", "code", "perl"),
  lua:    T("code", "code", "lua"),
  r:      T("code", "code", "r"),
  m:      T("code", "code", "none"),          // MATLAB / Objective-C 歧义，按纯文本显示
  sh:     T("code", "code", "bash"),
  bash:   T("code", "code", "bash"),
  zsh:    T("code", "code", "bash"),
  bat:    T("code", "code", "batch"),
  cmd:    T("code", "code", "batch"),
  ps1:    T("code", "code", "powershell"),
  sql:    T("code", "code", "sql"),
  yml:    T("code", "code", "yaml"),
  yaml:   T("code", "code", "yaml"),
  toml:   T("code", "code", "toml"),
  ini:    T("code", "code", "ini"),
  cfg:    T("code", "code", "ini"),
  conf:   T("code", "code", "ini"),
  properties: T("code", "code", "ini"),
  cmake:  T("code", "code", "cmake"),
  mk:     T("code", "code", "makefile"),
  tex:    T("code", "code", "latex"),
  cls:    T("code", "code", "latex"),
  sty:    T("code", "code", "latex"),
  bib:    T("code", "code", "latex"),
  html:   T("code", "code", "markup"),
  htm:    T("code", "code", "markup"),
  xml:    T("code", "code", "markup"),
  asm:    T("code", "code", "none"),

  /* ---------- 图片 ---------- */
  png:  T("image", "image"),
  jpg:  T("image", "image"),
  jpeg: T("image", "image"),
  jfif: T("image", "image"),
  gif:  T("image", "image"),
  webp: T("image", "image"),
  svg:  T("image", "image"),
  bmp:  T("image", "image"),
  avif: T("image", "image"),
  ico:  T("image", "image"),
  tif:  T("none", "image", "none",
           "浏览器不支持 .tif 图像，请用系统程序打开，或先转成 PNG / JPEG。"),
  tiff: T("none", "image", "none",
           "浏览器不支持 .tiff 图像，请用系统程序打开，或先转成 PNG / JPEG。"),
  heic: T("none", "image", "none",
           "浏览器不支持 .heic 图像，请用系统程序打开，或先转成 PNG / JPEG。"),
  heif: T("none", "image", "none",
           "浏览器不支持 .heif 图像，请用系统程序打开，或先转成 PNG / JPEG。"),
  psd:  T("none", "image", "none", "Photoshop 工程文件，请用 Photoshop 打开。"),

  /* ---------- 压缩包 ---------- */
  zip: T("zip", "zip"),
  rar: T("none", "zip", "none", "只支持 .zip 的清单预览；.rar 请用系统程序解压。"),
  "7z": T("none", "zip", "none", "只支持 .zip 的清单预览；.7z 请用系统程序解压。"),
  tar: T("none", "zip", "none", "只支持 .zip 的清单预览；.tar 请用系统程序解压。"),
  gz:  T("none", "zip", "none", "只支持 .zip 的清单预览；.gz 请用系统程序解压。"),
  tgz: T("none", "zip", "none", "只支持 .zip 的清单预览；.tgz 请用系统程序解压。"),
  bz2: T("none", "zip", "none", "只支持 .zip 的清单预览；.bz2 请用系统程序解压。"),
  xz:  T("none", "zip", "none", "只支持 .zip 的清单预览；.xz 请用系统程序解压。"),
  zst: T("none", "zip", "none", "只支持 .zip 的清单预览；.zst 请用系统程序解压。"),

  /* ---------- 其他 ---------- */
  fig: T("none", "other", "none", "MATLAB 图形文件（.fig）。阅读器不解析该格式，请用 MATLAB 打开。"),
  sav: T("none", "other", "none", "SPSS 数据文件，阅读器不解析该格式。"),
  djvu:T("none", "other", "none", "DjVu 文档，浏览器不能直接显示；请用系统程序打开。"),
};

/* 无扩展名的常见构建文件（按文件名认） */
const NAMED = {
  makefile: T("code", "code", "makefile"),
  dockerfile: T("code", "code", "docker"),
  ".gitignore": T("code", "code", "none"),
  ".gitattributes": T("code", "code", "none"),
  "cmakelists.txt": T("code", "code", "cmake"),
};

const FALLBACK = { view: "none", group: "other", lang: "none", note: "" };

export function extOf(name) {
  const i = String(name || "").lastIndexOf(".");
  return i > 0 ? String(name).slice(i + 1).toLowerCase() : "";
}

/* 传入文件名或节点，返回完整描述 */
export function formatFor(nameOrNode) {
  const name = typeof nameOrNode === "string" ? nameOrNode : (nameOrNode && nameOrNode.name) || "";
  const e = extOf(name);
  const f = FORMATS[e] || NAMED[String(name).toLowerCase()] || FALLBACK;
  const style = GROUP_STYLE[f.group] || GROUP_STYLE.other;
  return { ...f, ext: e, icon: style.icon, badge: style.badge };
}

export const isReadableName = (name) => formatFor(name).view !== "none";
export const viewerKindFor = (name) => formatFor(name).view;
export const prismLangFor = (name) => formatFor(name).lang;
export const isImageName = (name) => formatFor(name).view === "image";
