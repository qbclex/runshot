@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动本地服务器 http://localhost:8777 ...
start "" "http://localhost:8777/index.html"
python -m http.server 8777
if errorlevel 1 (
  echo.
  echo 未找到 python，请直接双击 index.html（离线底图模式可正常使用，
  echo 真实瓦片模式在 file:// 下可能因浏览器策略加载失败）。
  pause
)
