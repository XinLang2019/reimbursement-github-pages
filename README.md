# 报销材料整理助手 · GitHub Pages 版

这是从现有网站整理的独立静态项目，包含截至 2026-10-09 的功能（含历史报销记录删除及二次确认）。使用 React、TypeScript 和 Vite，无需后端、数据库服务或 API Key。

## 1. 部署到 GitHub Pages

### 创建仓库并上传源码

1. 在 GitHub 新建仓库，例如 `reimbursement-organizer`。使用免费账户时，选择 **Public** 仓库。先不要勾选自动创建 README、License 或 .gitignore。
2. 解压本项目，在**包含 `package.json` 的目录**打开终端。
3. 将下面地址中的 `YOUR_USERNAME` 和仓库名换成自己的，再执行：

```bash
git init -b main
git add .
git commit -m "Add reimbursement organizer"
git remote add origin https://github.com/YOUR_USERNAME/reimbursement-organizer.git
git push -u origin main
```

Git 会使用你电脑上配置的 GitHub 登录方式。也可以用 GitHub Desktop 将解压目录添加为本地仓库，再发布到 GitHub。无需安装 Node.js 即可使用 GitHub Actions 在线构建。

**不要把 ZIP 文件直接上传到仓库。** 仓库根目录应直接包含 `package.json`、`src/`、`public/` 和 `.github/`，不要再套一层项目目录。`.github/workflows/deploy-pages.yml` 是自动部署所必需的隐藏目录文件，请完整保留。项目包含多个 OCR 模型文件，建议使用 Git 或 GitHub Desktop 整体上传。

### 开启 Pages 并运行部署

1. 打开仓库 **Settings → Pages**。
2. 在 **Build and deployment → Source** 选择 **GitHub Actions**。
3. 打开 **Actions → Deploy to GitHub Pages → Run workflow**，选择 `main` 后运行。
4. 等待任务成功，点击部署结果中的网站链接。

首次推送如果发生在开启 Pages 之前，任务可能失败；完成上述设置后重新运行即可。后续每次向 `main` 推送代码都会自动重新部署。网站地址通常为：

```text
https://YOUR_USERNAME.github.io/reimbursement-organizer/
```

仓库名可以自定。工作流会读取 Pages 实际路径，自动兼容普通项目路径、`YOUR_USERNAME.github.io` 根域名仓库，以及在 Pages 设置中配置的自定义域名。不需要手动修改图片、字体或 OCR 模型路径。若使用非 `main` 分支，请修改 `.github/workflows/deploy-pages.yml` 中的 `branches`，并匹配 Pages 环境的部署分支设置。

官方文档：
- [自定义 GitHub Pages 工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [configure-pages 输出的部署路径](https://github.com/actions/configure-pages)

## 2. 本地运行和构建

安装 Node.js 22.13 或以上版本（建议使用 Node.js 22），在项目根目录执行：

```bash
npm ci
npm run dev
```

打开终端显示的本地地址。Windows、macOS、Linux 均可使用这些命令，无需 Bash 脚本。

```bash
npm run build
npm run preview
```

`build` 先检查 TypeScript，再生成 `dist/`；`preview` 启动本地静态预览。不要直接双击 `index.html`，发票识别所需的 Worker 和模块需要通过 HTTP/HTTPS 加载。`dist/`、`node_modules/` 已被 Git 忽略，无需提交。

如需本地验证项目子路径：

```bash
npm run build -- --base=/reimbursement-organizer/
npm run preview
```

随后打开预览地址下的 `/reimbursement-organizer/`。GitHub Actions 会自动传入实际路径，一般不需要设置环境变量。

## 3. 使用流程

| 页面 | 功能 |
| --- | --- |
| 历史报销列表 | 命名新建、自动保存、继续编辑、下载 ZIP/PDF、二次确认删除 |
| 第一步：整理材料 | 创建酒店、飞机、高铁、打车类别；上传发票与配套材料；识别和核对金额 |
| 第二步：报销清单 | 填写出差信息、自动计算天数和补助、读取交通与住宿金额、生成清单 PDF |
| 第三步：审核与导出 | 上传审核单、预览并下载合并 PDF、下载包含合并 PDF 的材料 ZIP |

最终顺序为：差旅报销审核单、差旅费报销清单、其余发票及配套材料按整理顺序排列。材料不全或清单需要重新生成时，历史列表中的下载按钮会暂时禁用，请进入编辑完成相应步骤。

## 4. 本地数据和迁移

- 记录、表单及材料保存在访问者当前浏览器的 IndexedDB 中，发票识别、生成 PDF 和压缩均在浏览器中进行。
- 源码包不包含任何访问者已上传的发票、截图或历史记录。
- 重新部署同一网址的代码不会主动清除记录。清除网站数据、更换浏览器/电脑、使用无痕模式可能导致记录丢失。
- **原网站与 GitHub Pages 属于不同网址，原来的历史记录不会自动出现在新网站。** 请先回原网站下载需要的 ZIP/PDF 备份。当前 ZIP 用于文档备份，没有一键恢复完整报销编辑状态的导入功能；如需继续整理，可解压后在新网站新建记录并上传材料。
- 删除记录会一并删除其浏览器本地材料，确认框取消则不删除。已下载到电脑的备份文件不受影响。
- 浏览器存储按来源隔离。同一个 `用户名.github.io` 下的多个路径可能共享存储；本项目适合在同一来源下部署一份。

## 5. 项目目录与维护

| 路径 | 用途 |
| --- | --- |
| `src/page.tsx` | 历史记录、新建与删除确认 |
| `src/reimbursement-editor.tsx` | 三步材料整理界面 |
| `src/reimbursement-storage.ts` | 本地自动保存和恢复 |
| `src/invoice-recognition.ts` | 发票金额解析与 OCR |
| `src/trip-claim-form.tsx` | 部门、公司菜单与出差信息表单 |
| `src/trip-claim.ts` | 天数、补助和清单绘制 |
| `src/reimbursement-model.ts` | 材料数据与 PDF 合并 |
| `src/materials-archive.ts` | ZIP 打包 |
| `public/vendor/` | 本地 PDF 引擎、OCR 引擎及中英文模型 |
| `public/fonts/` | 清单中文字体及许可证 |
| `.github/workflows/deploy-pages.yml` | GitHub Pages 自动部署 |
| `vite.config.ts` | 构建与部署路径配置 |

OCR、PDF 引擎和中文字体已随项目提供，运行时不需要从第三方 CDN 获取它们。首次识别需要加载模型，耗时会受网络和电脑性能影响；金额识别结果仍需核对。

常见问题：
- **Actions 提示找不到 Pages**：先在 Settings → Pages 开启 GitHub Actions，再重跑工作流。
- **网页空白或模型加载失败**：检查 `public/`、`.github/` 是否完整上传，是否通过 Actions 构建；不要直接用源码根目录作为 Pages 发布目录。
- **更名后仍显示旧页面**：确认新一轮部署成功后刷新；不要通过清除网站数据排查，以免同时删除本地记录。
- **菜单选项需要改**：部门、公司与出差标准分别在 `trip-claim-form.tsx`、`trip-claim.ts` 中维护。

本项目保留第三方资源的原有许可证。字体、PDF 引擎及 OCR 资源的许可说明随对应文件提供。
