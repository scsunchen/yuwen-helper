# 新增一个教材版本

本项目的教材版本是**数据驱动**的：新增版本只需放数据 + 改一处配置，**不需要修改任何前端代码**。

---

## 一、数据目录约定

```
data/textbook/
├── textbooks.json          ← 版本清单（在这里注册新版本）
├── rjb/                    人教部编版
│   ├── index.json          ← 该版本的册次清单
│   ├── 1年级上册/
│   │   ├── index.json      ← 该册的课文目录（页面按需加载这个文件）
│   │   ├── rjb-1s-01.json  ← 课文正文
│   │   └── ...
│   └── ...
└── sjb/                    ← 新增：苏教版（示例）
    ├── index.json
    └── 1年级上册/
        ├── index.json
        └── sjb-1s-01.json
```

**目录名规则**：`{年级}年级{册次}`，如 `1年级上册`、`5年级下册`。中文目录名会被自动 URL 编码，无需特殊处理。

---

## 二、三层 JSON 格式

### 1. `textbooks.json`（版本清单）

```json
{
  "version": 2,
  "default": "rjb",
  "textbooks": [
    {
      "id": "sjb",
      "name": "苏教版",
      "alias": "江苏教育出版社",
      "note": "江苏省部分地区使用",
      "grades": [1, 2, 3, 4, 5, 6],
      "bookCount": 12,
      "lessonCount": 320
    }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `id` | 版本标识，**同时是目录名**，建议用拼音缩写（`rjb` / `sjb` / `bsd`） |
| `name` | 界面上显示的名称（下拉选项文字） |
| `alias` | 别名，显示在选择项下方 |
| `note` | 备注说明 |
| `grades` | 该版本包含哪些年级，界面据此生成年级选项 |
| `bookCount` / `lessonCount` | 册数与课数统计，用于展示 |

### 2. `{id}/index.json`（该版本的册次清单）

```json
{
  "id": "sjb",
  "name": "苏教版",
  "alias": "江苏教育出版社",
  "note": "",
  "grades": [1, 2, 3, 4, 5, 6],
  "terms": ["上册", "下册"],
  "books": [
    { "key": "1-1", "grade": 1, "term": "上册", "dir": "1年级上册", "count": 16, "full": 16 },
    { "key": "1-2", "grade": 1, "term": "下册", "dir": "1年级下册", "count": 29, "full": 0 }
  ]
}
```

> `key` 规则：`{年级}-{1|2}`，1=上册，2=下册。`dir` 必须与磁盘目录名完全一致。

### 3. `{id}/{年级}年级{册次}/index.json`（该册课文目录）

```json
{
  "textbook": "苏教版",
  "textbookId": "sjb",
  "grade": 1,
  "term": "上册",
  "key": "1-1",
  "dir": "1年级上册",
  "count": 16,
  "full": 3,
  "lessons": [
    {
      "id": "sjb-1s-01",
      "title": "课文标题",
      "unit": "第一单元",
      "lessonType": "课文",
      "author": "作者",
      "stub": false,
      "n1": 6,
      "n2": 5,
      "charsAuto": false
    }
  ]
}
```

> `n1`/`n2` 是一类字/二类字数量，仅用于列表展示，可省略。
> `stub: true` 表示该课暂无讲解内容（仍可查看生字与笔顺）。

### 4. 课文正文 `{id}/{dir}/{课文id}.json`

```json
{
  "id": "sjb-1s-01",
  "title": "课文标题",
  "textbook": "苏教版",
  "grade": 1,
  "term": "上册",
  "unit": "第一单元",
  "lessonType": "课文",
  "author": "",
  "text": ["第一行原文", "第二行原文"],
  "summary": "内容概述",
  "centerThought": "中心思想",
  "segments": [{ "text": "段落原文", "note": "段落解析" }],
  "sentences": [{ "sentence": "重点句", "analysis": "赏析" }],
  "skills": ["写作特色1", "知识点2"],
  "classOne": ["一", "二", "三"],
  "classTwo": ["天", "地", "人"],
  "wordsOne": ["一天", "上下"],
  "wordsTwo": ["天地", "日月"],
  "homework": ["预习任务1"],
  "stub": false,
  "charsAuto": false
}
```

**最小可用版本**：只填 `id` / `title` / `textbook` / `grade` / `term` / `classOne` / `classTwo` 即可，其余字段缺省不影响运行。

---

## 三、操作步骤

### 方式 A：用脚本生成（推荐，保持格式统一）

1. 打开 `scripts/build_multiversion.py`，在 `TEXTBOOKS` 列表里加一条：

```python
TEXTBOOKS = [
    { "id": "rjb", "name": "人教部编版", "dir": "人教部编版", ... },
    # 新增：
    {
        "id": "sjb",
        "name": "苏教版",
        "alias": "江苏教育出版社",
        "dir": "苏教版",            # 源数据目录名
        "grades": [1, 2, 3, 4, 5, 6],
        "terms": ["上册", "下册"],
        "note": "江苏省部分地区使用",
    },
]
```

2. 把源数据按 `data/textbook/苏教版/{年级}年级{册次}/*.json` 放好
3. 运行：
   ```bash
   python3 scripts/build_multiversion.py
   ```
   脚本会自动生成 `textbooks.json`、版本索引、每册索引
4. 同步到站点目录并部署：
   ```bash
   rm -rf web-pages/data/textbook && cp -r data/textbook web-pages/data/textbook
   cd web-pages && git add . && git commit -m "新增苏教版" && git push
   ```

### 方式 B：手工创建

直接按上面的 JSON 格式手动写三个索引文件 + 课文文件即可。

---

## 四、生字表怎么来

新版本如果没有逐课生字表，可以复用已有的自动分配能力：

1. 在 `scripts/shengzi_data.py` 的 `SHENGZI` 里加入该版本的**整册写字表/识字表**
2. 运行 `python3 scripts/fill_chars.py`，脚本会：
   - 按课顺序把整册字表切分到各课
   - 用 jieba 词库为每课生字生成真实词语
   - 给课文打上 `charsAuto: true` 标记（页面会显示说明条）

**笔顺数据无需处理**——2139 字的笔顺动画库是通用的，任何版本的生字只要在这个库里就能播放动画。

---

## 五、注意事项

- **目录名必须与 `dir` 字段一致**，否则课文加载 404
- **`key` 不能重复**，且必须是 `{年级}-{1|2}` 格式
- **课文 `id` 建议带版本前缀**（如 `sjb-1s-01`），跨版本搜索时不会混淆
- 新增版本后**无需修改 `app.js` / `index.html`**，界面会自动出现新选项
- 版本数据较大时（笔顺数据按册 150KB~800KB），建议保持按册分片，不要合并成大文件
