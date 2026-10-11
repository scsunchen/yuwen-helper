# GitHub Pages 部署指南

本目录是一个**可直接部署的纯静态站点**，不需要任何构建步骤。以下三种方式任选其一。

---

## 方式一：网页上传（最简单，不懂 git 也能做）

1. 登录 [github.com](https://github.com)，点右上角 **+** → **New repository**
2. 仓库名随意（如 `yuwen-helper`），选 **Public**，点 **Create repository**
3. 仓库页点 **uploading an existing file**
4. 把 `web-pages` 目录里的**全部文件**拖进上传区（注意：是文件夹里的内容，不是文件夹本身；`index.html` 必须在仓库根目录）
   - 如果浏览器不支持拖文件夹，可用方式二或三
5. 点 **Commit changes**
6. 仓库 **Settings** → 左侧 **Pages** → **Source** 选 `Deploy from a branch`，Branch 选 `main` / `(root)` → **Save**
7. 等约 1 分钟，刷新 Pages 页面会显示网址：
   `https://<你的用户名>.github.io/<仓库名>/`

完成。手机浏览器打开该网址即可使用。

---

## 方式二：命令行推送（推荐）

```bash
# 进入本目录
cd web-pages

# 初始化并提交（如果还没有 git 仓库）
git init
git add .
git commit -m "小学语文预习小助手网页版"

# 关联你的远程仓库并推送（替换 <用户名> 和 <仓库名>）
git remote add origin https://github.com/<用户名>/<仓库名>.git
git branch -M main
git push -u origin main
```

然后在仓库网页上：**Settings → Pages → Branch 选 main /(root) → Save**。

以后更新内容只需：

```bash
git add . && git commit -m "更新" && git push
```

---

## 方式三：GitHub Actions 自动部署

本目录已内置 `.github/workflows/deploy.yml`。使用方法：

1. 推送代码到仓库（同方式二）
2. 仓库 **Settings → Pages → Source 改选 `GitHub Actions`**
3. 以后每次 `git push` 会自动部署，无需任何手工操作

---

## 常见问题

**Q: 打开后白屏 / 提示数据加载失败？**
A: 说明 `index.html` 不在仓库根目录。确认仓库根目录直接就是 `index.html`、`app.js`、`data/`，而不是嵌套了一层文件夹。

**Q: 访问 404？**
A: Settings → Pages 还没开启，或刚开启还没生效（等 1-2 分钟）。子路径部署已做兼容（全站相对路径），无需配置。

**Q: 笔顺动画不动？**
A: 笔顺数据按册分片加载，打开生字页时会自动加载对应册的 JSON（150KB~800KB）。若网络较慢请稍等；离线状态下第二次访问会直接从缓存读取。

**Q: 能绑定自己的域名吗？**
A: 可以。在仓库根目录添加 `CNAME` 文件（内容为你的域名），并在域名服务商配置 CNAME 指向 `<用户名>.github.io`。

**Q: 更新后手机上还是旧版本？**
A: Service Worker 有缓存。强制刷新一次（或清缓存）即可，之后会自动更新到新版本。

---

## 仓库体积参考

本站全量数据约 **8.2MB**（含 12 册笔顺动画数据），远低于 GitHub 仓库 1GB 建议值与 Pages 单文件 100MB 限制，部署无压力。
