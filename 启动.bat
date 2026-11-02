@echo off
chcp 65001>nul
setlocal
rem ============================================================
rem  大二资料阅读器 - 启动脚本（双击本文件）
rem ============================================================
cd /d "%~dp0"
set "PYEXE="
if exist ".venv\Scripts\python.exe" set "PYEXE=.venv\Scripts\python.exe"
if not defined PYEXE (
    for /f "delims=" %%i in ('where python 2^>nul') do if not defined PYEXE set "PYEXE=%%i"
)
if not defined PYEXE (
    echo [错误] 未找到 Python，请先安装 Python 3.10+ 并加入 PATH。
    echo        下载：https://www.python.org/downloads/
    pause
    exit /b 1
)

rem --- 已在运行（8765 可连通）则只打开页面，不重复启动第二个服务 ---
powershell -NoProfile -Command "try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1',8765); $c.Close(); exit 0 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 (
    echo 检测到阅读器服务已在运行，正在打开页面...
    start "" http://127.0.0.1:8765/
    ping -n 3 127.0.0.1 >nul 2>nul
    exit /b 0
)

echo 正在启动 大二资料阅读器 ...
start "大二资料阅读器" /min "%PYEXE%" server.py --no-browser
ping -n 4 127.0.0.1 >nul 2>nul

rem --- 等服务真正就绪后再打开浏览器 ---
powershell -NoProfile -Command "for($i=0;$i -lt 40;$i++){ try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1',8765); $c.Close(); exit 0 } catch { Start-Sleep -Milliseconds 250 } }; exit 1" >nul 2>nul
if errorlevel 1 (
    echo [错误] 服务启动失败，请查看日志：
    echo        %%LOCALAPPDATA%%\course-reader\logs\server.log
    echo        也可在命令行手动运行排查： python server.py
    pause
    exit /b 1
)

echo 已启动，正在打开浏览器 ...
start "" http://127.0.0.1:8765/
echo.
echo 服务地址：http://127.0.0.1:8765/
echo 关闭服务：书架页右上角「退出服务」按钮，或关闭最小化的命令行窗口。
ping -n 4 127.0.0.1 >nul 2>nul
endlocal
