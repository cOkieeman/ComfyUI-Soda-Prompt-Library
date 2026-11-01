# ComfyUI-Soda-Prompt-Library

在 ComfyUI 中看图选择角色、服饰和内容，预览组合后载入正文，再自由手改。只读本地素材库，保存工作流中的文字快照。

## 使用方式

1. 添加 **Soda → Prompt → Soda 提示词库**。
2. 点击“打开库…”，在角色 / 服饰 / 内容页签中看缩略图、搜索、筛选；选中后可查看大图。
3. 每类最多选一条，也可以留空。合并预览按 **角色 → 服饰 → 内容** 排列，以空行分隔。
4. 点击“载入正文”，再在节点的正文框里修改。已有不同正文时会提示是否整段替换。
5. 只想换一处时，用“复制提示词”，自行替换正文中的角色或服装描述。

合并预览按完整文字换行显示；长正文可点击“展开预览”放大阅读、复制全文。图片列表独立滚动，卡片不会随条目增多而压缩。

每页 60 条；内容页支持在整个当前筛选结果中随机选择。源库更新或删除不会覆盖工作流中的正文。没有选素材时也可直接手写，输出端就是当前正文。

## 安装

需要 Python 3.11+ 和支持 `comfy_api.latest` / V3 自定义节点的 ComfyUI。前端使用标准扩展 API、原生 dialog 和 JavaScript 模块，无需构建。

在 `ComfyUI/custom_nodes` 目录执行：

```shell
git clone https://github.com/cOkieeman/ComfyUI-Soda-Prompt-Library.git
```

重启 ComfyUI，再刷新浏览器。运行时只使用 Python 标准库与 ComfyUI 已有的 aiohttp，不需要额外 pip 安装。

导入 `examples/basic.json` 可检查节点显示。仓库附带少量通用文字示例，不附带个人图库；示例条目没有预览图。

## 配置素材来源

默认读取：

- ComfyUI 当前 user 目录下的 `aaalice/prompt-library/prompt-library.sqlite3`；顶层“角色”“服饰”分类及子分类。
- 本插件目录下 `library/*.json`，图片目录 `previews/`。首次使用时自行创建这两个目录。

也可以把 `config.example.json` 复制为 `config.json`，填写已有库的**绝对路径**。目录使用正斜线可避免 Windows JSON 转义问题。每个 JSON 数据源可指定 `kind` 为 `character`、`outfit` 或 `content`。配置中的 `json_sources` 会替换默认列表。

首次只想试用示例，可把 `json_sources` 分别指向本仓库 `examples/library/characters`、`examples/library/outfits`、`examples/library/content` 的绝对路径，并设置对应 `kind`。数据源 `id` 使用唯一的英文字母、数字、下划线或短横线。

Neons 只读取明确配置的 family 映射，避免把画师或画风当成角色。完整配置见 [数据格式与接入](docs/数据格式.md)。Aaalice 和 Neons 原有文件不会被迁移、修改或删除。

## 图片和数据格式

每条记录的 `preview` 指向本地图片，例如 `garden_001.webp`，相对于配置的 `preview_directory`。推荐 WebP、宽度 512px；支持 PNG、JPG、WebP、GIF。点击卡片后按“查看大图”，按 Escape 或“关闭大图”返回。

没有图片时填 `null`，显示“暂无预览”。节点不生成预览图，也不自动下载图片。工作流保存文字和组合快照，不嵌入图片；跨机器使用时需另带库和图片文件。

JSON 用 `schema: 1`。优先提供完整 `text`，也兼容原有 `subject` + `tags`。详见 [格式说明与可复制模板](docs/数据格式.md)。

## 接入现有工作流

节点只有一个 STRING 输出，可接收字符串的正文处理节点均可连接。

对于 **ImpactWildcardEncode**，把 `populated_text` 转成输入并连接本节点，模式设为 **fixed**。不要只连接 `wildcard_text`：Impact 实际执行读取的是 `populated_text`，前端 populate 行为可能覆盖或留下旧文本。

```text
Soda 提示词库 [手改正文]
    → ImpactWildcardEncode.populated_text [fixed]
    → 既有正文后续路径

质量 / 画风前缀、LoRA 触发词和后缀继续使用原有路径。
```

接入后在新节点正文框手改。Impact 或其他下游节点仍可能处理通配符、LoRA 等语法；本节点自身不改写输出。接其他模型时，直接保存适合该模型的完整文字，不自动翻译或把 tags 转为自然语言。

## 边界

- 不自动拆分角色与服装、不去重、不清理冲突词、不加载 LoRA、不调用 LLM。
- 多人物服装绑定交给 VRP 等分区工作流，本节点不保证人物与服装对应关系。
- “刷新库”只更新可浏览素材。重新点选条目才采用当前版本，重新载入仍需确认正文替换。
- 随机选择发生在面板中，选择后即保存快照，不是每次排队重抽。
- 预览接口只按已索引条目的 key 读取配置范围内的图片，不接受任意文件路径。接口沿用 ComfyUI 的访问控制；能访问实例的人也能访问配置的素材。
- `config.json`、本地库、图片、数据库和测试资料被 Git 忽略。公开工作流仍可能包含你保存的正文与快照，分享前请自行检查内容。

## 开发与验证

```shell
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run python -m unittest discover -s tests -v
node --test tests/model.test.js
```

不安装 uv 时也可在开发环境安装 aiohttp、ruff 后运行同样的 Python / Node 测试。Python 适配器与 HTTP 测试不依赖 GPU 或完整 ComfyUI。

布局回归页面：在仓库根目录运行 `python -m http.server 8192 --bind 127.0.0.1`，打开 `http://127.0.0.1:8192/tests/ui-fixture.html`。该页面使用 60 张通用素材卡片和 2270 字符正文，不读写个人库。检查卡片图片区域与名称完整显示、列表滚动、长正文展开与复制、窄窗口下底部按钮不遮挡预览。

GitHub Actions 配置模板位于 `docs/ci.example.yml`。当前发布凭据不具备 workflow 写入权限，因此仓库没有启用自动运行；有相应权限的维护者可以将模板复制到 `.github/workflows/check.yml` 启用 Windows / Linux 检查。

[开发计划与流程图](docs/开发计划.md) · [首版验证记录](docs/验证记录.md) · [MIT License](LICENSE)
