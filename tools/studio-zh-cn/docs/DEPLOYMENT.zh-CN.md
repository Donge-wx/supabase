# 部署说明

## 数据归属与版本

GitHub 仓库只保存汉化词典、脚本、配置与文档。`tools/studio-zh-cn/runtime/` 保存实际运行配置和持久化数据；整个目录被本包的 `.gitignore` 忽略。

以下命令都在 `tools/studio-zh-cn` 目录执行。`prepare` 获取 `UPSTREAM.lock.json` 指定的完整提交，不追踪滚动 master 或 latest。官方 Docker 配置来自同一个提交；Studio 单独从中文化源码构建。直接使用仓库原版 Docker 配置不会启用本包。

本工程使用上游支持的对称 HS256 JWT 模式。实际密钥随机生成，ANON_KEY 和 SERVICE_ROLE_KEY 按同一个 JWT_SECRET 签名。没有开启新的非对称 JWT 配置，不能认为两种模式均已联调。需要切换时，应按官方文档迁移并测试。

## 首次启动

需要 Node.js 22、npm、Python 3.10+、Git、Docker 和 Docker Compose 2.24.4+。Mac 请先启动 Docker Desktop。

```bash
npm install --ignore-scripts
npm test
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 scripts/manage.py install
```

如果端口冲突或检测到其他项目的同名 supabase 容器，脚本会停止。不会自动停止旧服务，也不会把旧数据目录接到新容器上。

若源码下载失败，`.upstream/supabase` 可能只完成 Git 初始化。先检查这个目录是否只有本工程下载中的文件，再重新取回锁定的提交。脚本不会使用强制 reset 掩盖失败，不应删除已有业务 runtime。

成功后访问 `http://localhost:8000`。账号为 admin，密码仅在本机 `runtime/.env` 的 DASHBOARD_PASSWORD 中。默认组织名称为「企业数据中心」，项目名称为「企业知识与数据」。这两个名字不会自动生成业务数据表。

## GitHub Actions

仓库根目录 `.github/workflows/studio-zh-cn-validate.yml` 在相关文件推送和 Pull Request 时运行本包测试，不部署服务器。

`.github/workflows/studio-zh-cn-build.yml` 需要手动触发。它下载固定版本、执行源码汉化并构建 Docker 镜像，可能消耗 Actions 配额。它不推送镜像、不启动生产数据库、不长期保留镜像，仅保留源码汉化匹配报告。

工作流文件存在，不代表构建已经成功。实际状态以仓库运行记录为准。新 fork 可能需要仓库所有者先在 Actions 页面启用工作流。

## 安全默认值

- 网关、数据库池化端口只绑定 127.0.0.1；Compose 的 !override 替换原端口列表，而非追加一个本机端口。
- 配置合成后再次检查所有暴露端口，发现非本机绑定即停止。
- 管理密码随机生成，保存在权限为 600 的 .env，不打印到日志。
- 默认关闭公开注册、匿名用户和手机注册，不自动配置真实邮件服务。
- 模型 Key 留空，不提交真实密钥。
- 已有 runtime/.env 不重新生成，避免数据库密码和新配置不一致。

## 停止与生产验收

```bash
python3 scripts/manage.py status
python3 scripts/manage.py stop
python3 scripts/manage.py start
```

stop 保留数据。不要执行上游 reset.sh 或 docker compose down -v。源码 restore 不是数据库回滚，也不能代替备份。

生产环境还需要 HTTPS、访问网段、管理入口隔离、数据库和附件备份、恢复测试、监控、员工身份、业务 RLS 及 Agent 工具授权。不要把管理后台暴露给所有员工，不要把可绕过 RLS 的服务端密钥共享给所有 Agent。

TZ=Asia/Shanghai 不代表所有日期控件已中文化。本包不进行时区数据迁移。

## 上游资料

- https://supabase.com/docs/guides/self-hosting/docker
- https://supabase.com/docs/guides/self-hosting/self-hosted-auth-keys
- https://github.com/supabase/supabase/tree/self-hosted/v0.8.1/docker
