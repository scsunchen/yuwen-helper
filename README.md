# 小学语文预习小助手 · 网页版

小学语文（部编版 1-6 年级）预习工具：**课文讲解 · 一类字/二类字 · 拼音 · 笔画数 · 笔顺动画 · 偏旁部首 · 字结构 · 词语积累**。

纯静态网页，零构建、零依赖、零后端，托管在 GitHub Pages 上，手机浏览器直接使用，支持离线访问。

## 在线使用

部署后访问：`https://<你的用户名>.github.io/<仓库名>/`

- **手机**：浏览器打开即用；通过「添加到主屏幕」可像 App 一样全屏使用
- **离线**：首次打开后自动缓存全部资源，之后断网也能用
- **数据**：323 篇课文、2548 个一类字、2556 个二类字、2139 字全量笔顺动画库

## 功能

| 功能 | 说明 |
|---|---|
| 教材设置 | 部编版 · 1-6 年级 · 上下册，设置保存在本机 |
| 课文目录 | 按单元分组展示，支持全 12 册跨册搜索课文标题 |
| 课程讲解 | 课文原文、内容概述、中心思想、分段解析、句子赏析、预习任务（1 年级上册 16 课为完整讲解，其余课文逐步补充） |
| 生字词学习 | 一类字（会写）/ 二类字（会认）/ 词语积累三个标签页 |
| 笔顺动画 | 每个字可播放笔顺、循环演示、逐笔查看、描红练习，速度可调 |
| 字卡信息 | 拼音（多音字）、笔画数、偏旁部首、字结构（左右/上下/半包围等） |

> 说明：除 1 年级上册外，各课生字表由「本册写字表/识字表」按课自动分配（页面内有提示条标注），供预习参考；笔顺动画覆盖全部生字。

## 本地运行

需要通过 HTTP 服务访问（直接双击 index.html 会因浏览器安全限制无法加载数据）：

```bash
cd web-pages
python3 -m http.server 8080
# 打开 http://localhost:8080
```

## 部署到 GitHub Pages

详见 [DEPLOY.md](DEPLOY.md)，最快路径：

1. 在 GitHub 新建仓库（Public）
2. 把本目录全部文件推送上去
3. 仓库 Settings → Pages → Source 选 `main` 分支 `/ (root)` → Save
4. 一分钟后访问 `https://<用户名>.github.io/<仓库名>/`

## 目录结构

```
web-pages/
├── index.html              应用入口（四页面 + 笔顺弹层）
├── style.css               样式（移动端优先）
├── app.js                  全部业务逻辑
├── sw.js                   Service Worker（离线缓存）
├── manifest.webmanifest    PWA 清单（可添加到主屏幕）
├── 404.html                路由兜底页
├── ADD_VERSION.md          「如何新增一个教材版本」开发文档
├── lib/
│   └── hanzi-writer.min.js 笔顺动画库 v3.5
└── data/
    ├── textbook/
    │   ├── textbooks.json  ★ 版本清单（新增版本在这里注册）
    │   └── rjb/            人教部编版
    │       ├── index.json      该版本的册次清单
    │       └── 1年级上册/
    │           ├── index.json  该册课文目录（按需加载）
    │           └── rjb-1s-01.json
    └── hanzi/
        ├── meta.json       2139 字元信息（拼音/部首/结构/笔画数）
        └── strokes/        12 册笔顺数据（每册一个 JSON，按需加载）
```

## 多版本架构

教材版本是**数据驱动**的，新增版本**不需要改任何前端代码**：

1. 数据按版本分目录：`data/textbook/{版本id}/{年级}年级{册次}/`
2. 版本清单 `textbooks.json` 描述有哪些版本可用
3. 用户选定版本 + 年级 + 册次后，**只加载那一册的索引**（约 4KB）
4. 进入生字页时再按需加载该册笔顺数据（150KB~800KB）

加载实测：首次打开仅拉版本清单；选定 3 年级上册后**只发 1 个册次请求**；跨册搜索时懒加载其余册次。

> 要新增版本（苏教版、北师大版等），详见 [ADD_VERSION.md](ADD_VERSION.md)。

## 技术要点

- **零构建**：原生 HTML/CSS/JS，无框架、无打包步骤，clone 即部署
- **笔顺动画**：[hanzi-writer](https://github.com/chanind/hanzi-writer) + [hanzi-writer-data](https://github.com/chanind/hanzi-writer-data)（Arphic Public License）
- **按需加载**：笔顺数据按册分片，用到哪册加载哪册（150KB~800KB/册）
- **离线可用**：Service Worker 双缓存策略（骨架 stale-while-revalidate / 数据 cache-first）
- **子路径兼容**：全部使用相对路径，`username.github.io/repo/` 子路径部署无需任何修改

## 数据来源与许可

- 字形/笔顺数据：[Make Me a Hanzi](https://github.com/skishore/makemeahanzi)（Arphic Public License）
- 教材目录：人民教育出版社·部编版小学语文（1-6 年级共 12 册）
- 拼音：[pypinyin](https://github.com/mozillazg/python-pinyin) 自动标注（多音字保留全部读音）
- 词语：jieba 词库按词频生成

## 相关版本

本项目另有三个交付形态（见主仓库）：

- `miniprogram/` — 微信小程序版（自研 Canvas 笔顺组件，13 分包）
- `prototype/` — 本网页版的开发原型
- `手机版/` — 1.4MB 单文件离线版（双击即用）
