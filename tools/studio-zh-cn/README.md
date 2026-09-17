# Supabase Studio 简体中文汉化包

本目录是 `Donge-wx/supabase` 中独立的汉化与自部署工程，默认语言为 **简体中文 `zh-CN`**。上游源码、根目录包配置和许可证保持原样。

## 使用

在仓库根目录进入本目录。需要 Node.js 22、npm、Python 3.10+、Git、Docker 与 Docker Compose 2.24.4+。Mac 请先启动 Docker Desktop。

```bash
cd tools/studio-zh-cn
npm install --ignore-scripts
npm test
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 scripts/manage.py install
```

也可以在仓库根目录执行 `bash 开始部署简体中文版.command`。

脚本下载 `UPSTREAM.lock.json` 锁定的官方 `self-hosted/v0.8.1` 源码，校验提交 SHA，应用本目录的中文词典，再使用官方 Dockerfile 构建 Studio。**汉化在构建时生效，不是给官方镜像设置一个环境变量。直接运行根目录上游 Docker 配置仍然使用官方原版镜像。**

成功启动后访问 `http://localhost:8000`。账号为 `admin`，随机密码仅保存在本机 `runtime/.env` 的 `DASHBOARD_PASSWORD`。不打印、不上传真实密钥。默认组织为「企业数据中心」，项目为「企业知识与数据」。

## 已包含

- `locales/zh-CN.json`：436 条简体中文词条。
- `locales/config.json`：默认语言 `zh-CN` 和严格的可翻译 UI 语法范围。
- `scripts/localize.cjs`：TypeScript 语法树级汉化、缺项报告、重复应用和恢复保护。
- `scripts/manage.py`：固定上游版本、随机密钥、本机端口、构建和健康检查。
- `tests/`：25 项 Node.js 测试、10 项 Python 测试及原始上游样本。
- 仓库根目录 `.github/workflows/studio-zh-cn-*.yml`：汉化测试和手动完整构建验证。

## 范围

已用真实上游文件验证 HTML 默认语言、主导航和数据库管理菜单。词典还覆盖表格、SQL、身份认证、存储、权限和 AI 助手常用静态文案，但**436 是词典条数，不是全站汉化完成率**。动态句子、服务端错误和未收录文案保留英文。

不会翻译 SQL、API 路径、字段值或用户输入；不运行浏览器 DOM 全局替换。完整匹配报告生成在 `.upstream/supabase/.studio-localization/report.json`。

## 分步执行

```bash
python3 scripts/manage.py prepare
python3 scripts/manage.py build
python3 scripts/manage.py start
python3 scripts/manage.py status
python3 scripts/manage.py stop
```

`stop` 保留数据。不要运行上游 `reset.sh` 或 `docker compose down -v`。默认只监听本机 8000、5432、6543 端口；发现其他同名 Supabase 容器时停止，不接管现有部署。

修改词典前先执行 `node scripts/localize.cjs restore .upstream/supabase`；再重新 `apply`、构建和启动。恢复操作遇到人工源码改动会拒绝覆盖。

## 验证与边界

[测试记录](docs/VALIDATION.zh-CN.md)区分本地单元测试、GitHub CI、完整镜像构建与生产服务状态。提交代码不等于已上线数据库。GitHub 托管源码，服务需要在 Mac 或服务器运行。

本工程只交付中文管理后台和基础设施，不含已经配置好的员工工作台、企业业务表或知识库。不要向员工或普通 Agent 发放管理后台账号、`SERVICE_ROLE_KEY`。

文档：[部署说明](docs/DEPLOYMENT.zh-CN.md) · [汉化规则](docs/LOCALIZATION.zh-CN.md)。许可：Apache-2.0；上游文件和第三方组件保留原许可，见 `LICENSE` 与 `NOTICE`。
