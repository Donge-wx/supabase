# Supabase 简体中文部署入口

此 fork 保留 Supabase 上游源码，在 [`tools/studio-zh-cn`](tools/studio-zh-cn) 提供独立汉化包与自部署入口。**通过该入口构建的 Studio 默认使用简体中文 `zh-CN`。**

```bash
cd tools/studio-zh-cn
npm install --ignore-scripts
npm test
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 scripts/manage.py install
```

Mac / Linux 也可以在仓库根目录执行：

```bash
bash 开始部署简体中文版.command
```

需要 Node.js 22、Python 3.10+、Git、Docker、Docker Compose 2.24.4+；Mac 请先启动 Docker Desktop。

- [完整说明](tools/studio-zh-cn/README.md)
- [简体中文词典](tools/studio-zh-cn/locales/zh-CN.json)
- [默认语言设置](tools/studio-zh-cn/locales/config.json)
- [实际验证记录](tools/studio-zh-cn/docs/VALIDATION.zh-CN.md)

汉化包固定基于官方 `self-hosted/v0.8.1`，不会随本 fork 的 master 更新静默更换数据库版本。**直接运行上游原版 Docker 镜像不会启用汉化。**

提交源码不等于已部署服务。当前词典含 436 条文案，主导航、数据库菜单和 HTML 默认语言经过源码测试；完整镜像与浏览器验收以测试记录为准，未覆盖的文案仍可能显示英文。

本仓库公开，请勿提交运行数据、`.env`、真实密钥或企业资料。原始项目说明与许可证保持在 [README.md](README.md) 和 [LICENSE](LICENSE)。
