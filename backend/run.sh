#!/usr/bin/env bash
# 启动 Spring Boot 后端（Git Bash / WSL）。
#
# 为什么需要这个脚本而不是直接 java -jar：
# 这台机器的 Windows 用户目录是中文（C:\Users\谢光益）。从 Git Bash 启动时，
# 传进 JVM 的 TEMP 会按 GBK 解码成乱码路径：
#   java.io.tmpdir = C:\Users\Ð»¹âÒæ\AppData\Local\Temp\
# 这个目录不存在，Spring Boot 建不了 Tomcat 工作目录，启动直接失败。
#
# 现在 application.yml 里已经设了 server.tomcat.basedir: ./target/tomcat，
# Tomcat 不再碰 java.io.tmpdir，所以这里不需要额外参数。
# 保留脚本只是为了不用记路径。
set -euo pipefail
cd "$(dirname "$0")"

JAR="target/ai-chat-backend-0.1.0.jar"
if [ ! -f "$JAR" ]; then
  echo "找不到 $JAR —— 先执行：mvn -o package -DskipTests" >&2
  exit 1
fi

echo "后端 → http://localhost:8015   (Ctrl+C 停止)"
exec java -jar "$JAR" "$@"
