# 重建「Atelier Study」桌面快捷方式
# 用法：右键「使用 PowerShell 运行」，或在项目根执行：
#   powershell -ExecutionPolicy Bypass -File .\tools\创建桌面快捷方式.ps1
#
# 说明（重要）：图标文件必须放在项目目录之外（这里用 %LOCALAPPDATA%\AtelierStudy）。
# 项目目录及其文件带有继承的 Low 完整性标签，资源管理器的图标加载进程读不到，
# 快捷方式会退化成空白页图标。详见 PROJECT_STATUS.md「桌面快捷方式」一节。

$ErrorActionPreference = 'Stop'

$root    = Split-Path -Parent $PSScriptRoot
$srcIco  = Join-Path $root 'assets\atelier-book.ico'
$icoDir  = Join-Path $env:LOCALAPPDATA 'AtelierStudy'
$icoPath = Join-Path $icoDir 'atelier.ico'
$desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktop 'Atelier Study.lnk'
$batPath = Join-Path $root '启动.bat'

if (-not (Test-Path $srcIco)) { throw "缺少图标源文件：$srcIco" }
if (-not (Test-Path $batPath)) { throw "缺少启动脚本：$batPath" }

New-Item -ItemType Directory -Force -Path $icoDir | Out-Null
Copy-Item $srcIco $icoPath -Force

$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($lnkPath)
$lnk.TargetPath       = $batPath
$lnk.WorkingDirectory = $root
$lnk.IconLocation     = "$icoPath,0"
$lnk.WindowStyle      = 7   # 最小化启动，服务日志进 %LOCALAPPDATA%\course-reader\logs
$lnk.Description      = 'Atelier Study — 个人学术资料工作台（大二资料阅读器 P2.0）'
$lnk.Save()

Write-Host "已创建：$lnkPath"
Write-Host "图标：$icoPath"
Write-Host "如果桌面仍显示白色空白图标，注销/重启资源管理器后再看一次。"
