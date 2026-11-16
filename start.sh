#!/bin/sh
# RUNSHOT 本地服务器启动器（Linux）
cd "$(dirname "$0")" || exit 1

PORT=8777
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "未找到 Python 3，无法启动本地服务器。"
  echo "可以先直接用浏览器打开 index.html 使用离线底图模式。"
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
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1
else
  echo "请手动打开：$URL"
fi

LAN=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
echo "服务器已启动，页面已自动打开：$URL"
[ -n "$LAN" ] && echo "手机连同一个 Wi-Fi，打开：http://$LAN:$PORT/index.html"
echo "按 Ctrl+C 即停止服务器。"
wait "$SERVER"
