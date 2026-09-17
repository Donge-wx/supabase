# 汉化规则与验收

## 实现方式

locales/config.json 默认语言为 zh-CN。汉化器使用 TypeScript 语法树选择静态界面文案，再在构建前写入中文。服务端渲染和客户端使用同一份中文源代码，不依赖网页加载后遍历 DOM，也不把用户数据发送到翻译服务。

支持：JSX 文本节点、直接展示的 JSX 字符串表达式、受控 title/placeholder/aria-label 等属性、Sonner 静态提示，以及两个已审核导航文件中的显示字段。

不改动：数据库记录对象、接口路径、SQL、鉴权代码、变量和对象键、表名、列名、表单 value/id、字符串比较条件、动态接口响应和用户输入。

扫描范围不含 apps/studio/data、状态模块、API 路由、测试、mock 和声明文件。代码块、可编辑区域和 data-no-localize 区域也跳过。复杂动态句子及把显示文字当作业务键的代码需逐处审核，不能扩展为任意字符串替换。

## 已验证的上游文件

| 文件 | 原始 Git blob SHA |
|---|---|
| apps/studio/pages/_document.tsx | 8560136df0f427c05b451c4300bf50cb011aee65 |
| apps/studio/components/layouts/Navigation/NavigationBar/NavigationBar.utils.tsx | c319886c8f9cfb03558a7857c8fea09fc0fb4554 |
| apps/studio/components/layouts/DatabaseLayout/DatabaseMenu.utils.tsx | 3a24136e309d442a517e4a56ab0c7381f50cf7f5 |

主导航覆盖表格编辑器、SQL 编辑器、数据浏览器、数据库、身份认证、文件存储、边缘函数、实时数据、诊断建议、运行监控、日志、集成和项目设置。

数据库菜单覆盖数据库结构图、数据表、函数、触发器、枚举、扩展、索引、发布、访问策略、角色、列权限、设置、数据复制、备份和迁移等。

其他词条不等于对应全部页面已验证。

## 缺项和覆盖率

每次完整应用后生成 .studio-localization/report.json，包括扫描文件数、修改文件数、匹配次数、唯一词条数、未匹配静态候选和未使用词条。

这些统计只覆盖汉化器支持的静态语法，不能当作全产品汉化率。未匹配文字原样保留。

## 补充词条

在本包目录执行：

```bash
node scripts/localize.cjs restore .upstream/supabase
# 编辑 locales/zh-CN.json 后运行：
npm test
node scripts/localize.cjs apply .upstream/supabase
python3 scripts/manage.py build
python3 scripts/manage.py start
```

不要在已经中文化的源码上直接修改词典后继续追加。程序通过哈希阻止不一致更新；存在人工源码修改时，restore 拒绝覆盖。

对象字段翻译必须在 objectPropertiesByFile 中列出具体文件和字段，不要全局开放所有对象的 name、title、description。

## 目标机器上的验收

浏览器检查初始 HTML 的 lang 为 zh-CN、导航和数据库菜单中文显示；检查初次加载和路由切换无水合错误；在表格里写入英文 Save、Name、Delete，确认业务值保持原文；执行 SQL，确认表名、列名和结果不被改写；再逐页检查英文缺项与中文布局。

以上浏览器与完整服务验收尚未在当前环境执行。
