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

set /a TRY=0
:wait
set /a TRY+=1
powershell -NoProfile -Command "try { $c = New-Object Net.Sockets.TcpClient('127.0.0.1', 8777); $c.Close(); exit 0 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 goto open
if %TRY% geq 15 goto failed
ping -n 2 127.0.0.1 >nul
goto wait

:open
start "" "http://localhost:8777/index.html"
set "LAN="
for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null } | Select-Object -First 1).IPv4Address.IPAddress" 2^>nul') do set "LAN=%%i"
echo.
echo 服务器已启动，页面已自动打开：http://localhost:8777/index.html
if defined LAN echo 手机连同一个 Wi-Fi，打开：http://%LAN%:8777/index.html
echo 关闭此窗口即停止服务器。
pause >nul
exit /b 0

:failed
echo.
echo 服务器没有启动成功，请把上面的错误信息发给我。
pause
exit /b 1
