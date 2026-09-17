# 汉化包测试记录

日期：2026-09-17。对象：本包源码、翻译词典与部署管理脚本，不是已经上线的 Supabase 服务。

## 提交前重新运行的检查

| 检查 | 实际结果 |
|---|---|
| Node.js 单元测试 | 25 / 25 通过 |
| Python 单元测试 | 10 / 10 通过 |
| 上游样本完整性 | 3 份样本 Git blob SHA 校验通过 |
| 默认语言 | 配置 zh-CN，HTML 源码转换测试通过 |
| 主导航 | 13 处静态文案匹配，路由和对象键不变 |
| 数据库菜单 | 显示文案转换通过，数据路由不变 |
| SQL、业务数据和表单值保护 | 样本单元测试通过 |
| 幂等应用、恢复和人工修改保护 | 单元测试通过 |
| 随机密钥、JWT 签名和本机端口检查 | 单元测试通过 |
| JavaScript 与启动 Shell 语法 | 检查通过 |
| 远端待提交代码与本地测试内容 | 核心脚本、词典、配置、测试和样本共 10 个文件的 Git blob SHA 一致 |

环境：Node.js 22.16.0、TypeScript 5.8.3、Python 3.13.5。当前容器 npm registry 下载曾发生 DNS 失败，本地测试使用已安装的同版本 TypeScript，经 NODE_PATH 解析。项目正常使用不需要设置该环境路径。

在 tools/studio-zh-cn 目录运行：

```bash
npm install --ignore-scripts
npm test
python3 -m unittest discover -s tests -p 'test_*.py' -v
node --check scripts/localize.cjs
bash -n 开始部署.command
```

## 提交形态

汉化工程放入 tools/studio-zh-cn，不覆盖上游根目录 package.json、README、LICENSE 或数据库源码。根目录提供中文说明与启动入口；汉化包工作流位于根 .github/workflows，命令工作目录已调整。

## 尚未完成

未在当前容器完成完整源码下载、完整 Studio Docker 构建、数据库启动、浏览器交互验收或生产部署。当前容器无 Docker，也未获得目标运行主机。

GitHub Actions 结果以仓库真实运行记录为准，不能把本地 35 项测试当作 GitHub CI 成功。完整构建仅手动触发，不启动生产服务，不上传运行目录或密钥。

436 是词典条数，不是已验证页面数或全站汉化率。完整源码应用后的报告会列出实际匹配次数和英文缺项。
