@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY (
  where py >nul 2>nul && set "PY=py"
)
if not defined PY (
  where python3 >nul 2>nul && set "PY=python3"
)

if not defined PY (
  echo 未找到 Python，无法启动本地服务器。
  echo 可以直接双击 index.html 使用离线底图模式；
  echo 真实瓦片模式在 file:// 下可能因浏览器策略加载失败。
  echo.
  echo 如已安装 Python，请重新登录 Windows 后再试，或把 python 加入 PATH。
  pause
  exit /b 1
)

echo 正在启动本地服务器 http://localhost:8777 ...
start "" /b %PY% -m http.server 8777
ping -n 2 127.0.0.1 >nul

start "" "http://localhost:8777/index.html"
echo.
echo 服务器已启动：关闭此窗口即停止服务器。
pause >nul
