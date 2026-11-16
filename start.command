#!/bin/sh
# RUNSHOT 本地服务器启动器：macOS 双击运行，Linux 可用 sh start.command
cd "$(dirname "$0")" || exit 1

PORT=8777
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "未找到 Python 3，无法启动本地服务器。"
  echo "可以先直接双击 index.html 使用离线底图模式。"
  printf "按回车键退出…"
  read -r _
  exit 1
fi

echo "正在启动本地服务器 http://localhost:$PORT ..."
"$PY" -m http.server "$PORT" &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' INT TERM EXIT

i=0
while [ "$i" -lt 30 ]; do
  if "$PY" -c "import socket; s=socket.socket(); s.settimeout(0.3); s.connect(('127.0.0.1', $PORT)); s.close()" 2>/dev/null; then
    break
  fi
  i=$((i + 1))
  sleep 0.2
done

URL="http://localhost:$PORT/index.html"
if command -v open >/dev/null 2>&1; then
  open "$URL" 2>/dev/null
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1
else
  echo "请手动打开：$URL"
fi

if command -v ipconfig >/dev/null 2>&1; then
  LAN=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
else
  LAN=$(hostname -I 2>/dev/null | awk '{print $1}')
fi

echo
echo "服务器已启动，页面已自动打开：$URL"
[ -n "$LAN" ] && echo "手机连同一个 Wi-Fi，打开：http://$LAN:$PORT/index.html"
echo "关闭此窗口或按 Ctrl+C 即停止服务器。"
wait "$SERVER"
