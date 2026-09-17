#!/usr/bin/env python3
"""Prepare, build and run the pinned Supabase self-hosted stack. Never reset data."""
from __future__ import annotations
import argparse
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
LOCK = json.loads((ROOT / "UPSTREAM.lock.json").read_text())
SOURCE = ROOT / ".upstream" / "supabase"
RUNTIME = ROOT / "runtime"
PROJECT = "ai-work-os-supabase-zh-cn"


def run(args: list[str], *, cwd: Path = ROOT, capture: bool = False,
        quiet: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(args, cwd=cwd, check=True, text=True,
                          stdout=subprocess.PIPE if capture else subprocess.DEVNULL if quiet else None,
                          stderr=subprocess.PIPE if capture else None)


def require(*names: str) -> None:
    missing = [n for n in names if not shutil.which(n)]
    if missing:
        raise RuntimeError("请先安装：" + "、".join(missing))


def parse_env(text: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if re.fullmatch(r"[A-Z][A-Z0-9_]*", key):
            result[key] = value.strip().strip('"').strip("'")
    return result


def replace_env(text: str, values: dict[str, str]) -> str:
    lines, seen = [], set()
    for line in text.splitlines():
        key = line.split("=", 1)[0]
        if key in values and "=" in line:
            if key not in seen:
                lines.append(f"{key}={values[key]}")
                seen.add(key)
        else:
            lines.append(line)
    lines.extend(f"{k}={v}" for k, v in values.items() if k not in seen)
    return "\n".join(lines) + "\n"


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def jwt_for_role(secret: str, role: str) -> str:
    now = int(time.time())
    header = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = b64url(json.dumps({"role": role, "iss": "supabase", "iat": now,
                               "exp": now + 5 * 365 * 86400}, separators=(",", ":")).encode())
    data = f"{header}.{payload}"
    return data + "." + b64url(hmac.new(secret.encode(), data.encode(), hashlib.sha256).digest())


def new_environment(template: str) -> str:
    """Use the upstream-supported symmetric JWT mode; no network and no secret output."""
    jwt_secret = secrets.token_hex(32)
    values = {
        "COMPOSE_FILE": "docker-compose.yml:docker-compose.zh-CN.yml",
        "POSTGRES_PASSWORD": secrets.token_hex(24), "JWT_SECRET": jwt_secret,
        "ANON_KEY": jwt_for_role(jwt_secret, "anon"),
        "SERVICE_ROLE_KEY": jwt_for_role(jwt_secret, "service_role"),
        "DASHBOARD_USERNAME": "admin",
        # Guaranteed letters + numbers, without characters that break Basic auth config.
        "DASHBOARD_PASSWORD": "Sb" + secrets.token_hex(24),
        "SECRET_KEY_BASE": secrets.token_hex(48),
        "REALTIME_DB_ENC_KEY": secrets.token_hex(8),
        "VAULT_ENC_KEY": secrets.token_hex(16),
        "PG_META_CRYPTO_KEY": secrets.token_hex(24),
        "LOGFLARE_PUBLIC_ACCESS_TOKEN": secrets.token_hex(24),
        "LOGFLARE_PRIVATE_ACCESS_TOKEN": secrets.token_hex(24),
        "S3_PROTOCOL_ACCESS_KEY_ID": secrets.token_hex(16),
        "S3_PROTOCOL_ACCESS_KEY_SECRET": secrets.token_hex(32),
        "MINIO_ROOT_PASSWORD": secrets.token_hex(24),
        "SUPABASE_PUBLISHABLE_KEY": "", "SUPABASE_SECRET_KEY": "",
        "JWT_KEYS": "", "JWT_JWKS": "",
        "SUPABASE_PUBLIC_URL": "http://localhost:8000",
        "API_EXTERNAL_URL": "http://localhost:8000/auth/v1",
        "SITE_URL": "http://localhost:3000",
        "STUDIO_DEFAULT_ORGANIZATION": "企业数据中心",
        "STUDIO_DEFAULT_PROJECT": "企业知识与数据",
        "POOLER_TENANT_ID": "enterprise-" + secrets.token_hex(6),
        "OPENAI_API_KEY": "", "DISABLE_SIGNUP": "true",
        "ENABLE_ANONYMOUS_USERS": "false", "ENABLE_PHONE_SIGNUP": "false",
        "ENABLE_PHONE_AUTOCONFIRM": "false", "FUNCTIONS_VERIFY_JWT": "true",
    }
    return replace_env(template, values)


def validate_environment(text: str) -> None:
    env = parse_env(text)
    for name in ["POSTGRES_PASSWORD", "JWT_SECRET", "DASHBOARD_PASSWORD", "SECRET_KEY_BASE",
                 "PG_META_CRYPTO_KEY", "VAULT_ENC_KEY", "REALTIME_DB_ENC_KEY"]:
        value = env.get(name, "")
        if not value or "your-" in value or "insecure" in value or "supabaserealtime" == value:
            raise RuntimeError(f"未设置安全配置：{name}（不会打印密钥）")
    for name, minimum in {"POSTGRES_PASSWORD": 24, "JWT_SECRET": 32,
                          "DASHBOARD_PASSWORD": 24, "SECRET_KEY_BASE": 64,
                          "PG_META_CRYPTO_KEY": 32}.items():
        if len(env[name]) < minimum:
            raise RuntimeError(f"{name} 长度不足；不会打印密钥")
    if len(env["REALTIME_DB_ENC_KEY"]) != 16 or len(env["VAULT_ENC_KEY"]) != 32:
        raise RuntimeError("加密密钥长度不符合上游要求")
    for name, role in [("ANON_KEY", "anon"), ("SERVICE_ROLE_KEY", "service_role")]:
        try:
            header, payload, signature = env[name].split(".")
            expected = b64url(hmac.new(env["JWT_SECRET"].encode(),
                                      f"{header}.{payload}".encode(), hashlib.sha256).digest())
            decoded = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
            if not hmac.compare_digest(signature, expected) or decoded["role"] != role:
                raise ValueError("signature or role")
            if decoded["exp"] <= time.time():
                raise ValueError("expired")
        except (ValueError, KeyError, TypeError) as exc:
            raise RuntimeError(f"{name} 无效；请重新核对密钥，勿直接重置已有数据库") from exc


def prepare() -> None:
    require("git", "node")
    if not re.fullmatch(r"[a-f0-9]{40}", LOCK["commit"]):
        raise RuntimeError("UPSTREAM.lock.json 的 commit 无效")
    if not SOURCE.exists():
        SOURCE.mkdir(parents=True)
        run(["git", "init", "--quiet"], cwd=SOURCE)
        run(["git", "remote", "add", "origin", LOCK["repository"]], cwd=SOURCE)
        run(["git", "fetch", "--depth=1", "origin", LOCK["commit"]], cwd=SOURCE)
        run(["git", "checkout", "--detach", "FETCH_HEAD"], cwd=SOURCE)
    if not (SOURCE / ".git").exists():
        raise RuntimeError(".upstream/supabase 已存在且不是 Git 仓库；不会覆盖")
    current = run(["git", "rev-parse", "HEAD"], cwd=SOURCE, capture=True).stdout.strip()
    if current != LOCK["commit"]:
        raise RuntimeError("已有上游源码版本不匹配；不会 reset 或覆盖，请使用新的工程目录")
    run(["node", "scripts/localize.cjs", "apply", str(SOURCE)])
    if RUNTIME.exists():
        marker = RUNTIME / ".deployment.json"
        if not marker.exists() or json.loads(marker.read_text())["commit"] != LOCK["commit"]:
            raise RuntimeError("runtime 目录已存在且不属于本版本；不会覆盖已有数据")
        validate_environment((RUNTIME / ".env").read_text())
        print("复用现有运行目录和密钥，没有重置数据库。")
        return
    stage = ROOT / "runtime.prepare"
    if stage.exists():
        raise RuntimeError("发现未完成的 runtime.prepare；请先检查，不会自动覆盖")
    shutil.copytree(SOURCE / "docker", stage)
    env = new_environment((stage / ".env.example").read_text())
    validate_environment(env)
    fd = os.open(stage / ".env", os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "w", encoding="utf8") as f:
        f.write(env)
    shutil.copy2(ROOT / "deploy/docker-compose.zh-CN.yml", stage / "docker-compose.zh-CN.yml")
    (stage / ".deployment.json").write_text(json.dumps({"commit": LOCK["commit"],
        "project": PROJECT, "locale": "zh-CN"}, indent=2) + "\n")
    stage.rename(RUNTIME)
    print("运行目录已生成。密钥仅存于 runtime/.env，没有上传或打印。")


def require_docker() -> None:
    require("docker")
    run(["docker", "info"], capture=True)
    version = run(["docker", "compose", "version", "--short"], capture=True).stdout.strip()
    found = re.search(r"(\d+)\.(\d+)\.(\d+)", version)
    if not found or tuple(map(int, found.groups())) < (2, 24, 4):
        raise RuntimeError("需要 Docker Compose 2.24.4 或更新版本（安全覆盖端口用）")


def compose(*args: str, capture: bool = False):
    if not (RUNTIME / ".deployment.json").exists():
        raise RuntimeError("请先运行 prepare")
    return run(["docker", "compose", "--project-name", PROJECT,
                "--env-file", ".env", "-f", "docker-compose.yml", "-f",
                "docker-compose.zh-CN.yml", *args], cwd=RUNTIME, capture=capture)


def validate_compose(config: dict) -> None:
    services = config.get("services", {})
    if services.get("studio", {}).get("image") != LOCK["image"]:
        raise RuntimeError("Studio 未使用本地构建的汉化镜像")
    for name, service in services.items():
        for port in service.get("ports", []):
            if port.get("host_ip") not in {"127.0.0.1", "::1"}:
                raise RuntimeError(f"服务 {name} 存在非本机监听端口；此脚本不自动开放公网")


def check_container_conflicts() -> None:
    output = run(["docker", "ps", "-a", "--format",
                  '{{.Names}}\t{{.Label "com.docker.compose.project"}}'], capture=True).stdout
    for row in output.splitlines():
        name, _, project = row.partition("\t")
        if (name.startswith("supabase-") or name == "realtime-dev.supabase-realtime") and project != PROJECT:
            raise RuntimeError(f"检测到其他部署的容器 {name}；不会停止、替换或接管")


def build() -> None:
    require_docker()
    if not (SOURCE / ".studio-localization/state.json").exists():
        raise RuntimeError("请先运行 prepare 完成源码汉化")
    # Recheck localization state: reject source edits or a changed translation pack.
    run(["node", "scripts/localize.cjs", "apply", str(SOURCE)])
    run(["docker", "build", "--file", "apps/studio/Dockerfile", "--target", "production",
         "--build-arg", "STUDIO_FRAMEWORK=next", "--tag", LOCK["image"], "."], cwd=SOURCE)
    print("汉化镜像构建完成；尚未启动数据库。")


def start() -> None:
    require_docker()
    check_container_conflicts()
    if not RUNTIME.exists():
        raise RuntimeError("请先运行 prepare")
    validate_environment((RUNTIME / ".env").read_text())
    config = json.loads(compose("config", "--format", "json", capture=True).stdout)
    validate_compose(config)  # Configuration can contain secrets; never print it.
    run(["docker", "image", "inspect", LOCK["image"]], capture=True)
    compose("up", "-d", "--wait", "--wait-timeout", "300", "--pull", "missing")
    print("所有服务已通过 Compose 健康检查。管理入口：http://localhost:8000")
    print("账号：admin；密码请在本机 runtime/.env 的 DASHBOARD_PASSWORD 中查看。")


def main() -> None:
    parser = argparse.ArgumentParser(description="Supabase 简体中文自部署；不会删除数据库")
    parser.add_argument("action", choices=["prepare", "build", "start", "stop", "status", "install"])
    args = parser.parse_args()
    if args.action == "install":
        require_docker(); prepare(); build(); start()
    elif args.action == "prepare": prepare()
    elif args.action == "build": build()
    elif args.action == "start": start()
    elif args.action == "stop":
        require_docker(); compose("stop")
        print("已停止服务，数据卷和 runtime 目录保留。")
    elif args.action == "status":
        require_docker(); compose("ps")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError:
        # Do not echo captured command output: config and build tooling may contain secrets.
        print("操作失败，已停止。请检查本机依赖、网络和上一条非密钥日志；没有报告部署成功。", file=sys.stderr)
        sys.exit(1)
    except (RuntimeError, OSError, KeyError, ValueError) as exc:
        print(f"操作失败：{exc}", file=sys.stderr)
        sys.exit(1)
