# 启动 Spring Boot 后端。
#
# PowerShell / cmd 下 TEMP 是正确的，不会有 Git Bash 那个中文路径编码问题，
# 但 application.yml 里已经设了 server.tomcat.basedir，两边都安全。
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$jar = Join-Path $PSScriptRoot 'target\ai-chat-backend-0.1.0.jar'
if (-not (Test-Path -LiteralPath $jar)) {
    Write-Error "找不到 $jar —— 先在 backend 目录执行：mvn -o package -DskipTests"
    exit 1
}

Write-Host '后端 → http://localhost:8015   (Ctrl+C 停止)' -ForegroundColor Cyan
java -jar $jar @args
