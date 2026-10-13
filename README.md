# 亚马逊图片工作台

亚马逊图片工作台是一个面向 Amazon Listing 的产品图片策划与生成工作台，基于 [CookSleep/gpt_image_playground](https://github.com/CookSleep/gpt_image_playground) 修改。

它适合用来把产品标题、五点描述、卖点文案和参考图，整理成 Amazon Listing 图片或 A+ Content 图片策划，并逐张生成图片。

项目仓库：[Atomic994/amazon-image-studio](https://github.com/Atomic994/amazon-image-studio)，当前版本由 Atomic994 维护。

## 开源说明

> [!IMPORTANT]
> **开源与第三方收费说明**
>
> 本项目基于开源软件修改，请以当前版本的 [GitHub 仓库](https://github.com/Atomic994/amazon-image-studio) 作为核验入口。本项目采用 MIT License，允许商业使用、分发和售卖软件副本，但必须保留版权与许可声明。
>
> 第三方收取的费用只代表其自行提供的部署、定制、培训或技术支持，不代表购买了本软件、获得独家授权，也不代表 Atomic994 提供或认可的服务。请警惕“官方付费版”“独家授权版”“买断后永久官方更新”等误导性表述。
>
> 如发现冒充官方、删除署名或隐瞒开源来源的售卖行为，请通过 [GitHub Issues](https://github.com/Atomic994/amazon-image-studio/issues) 反馈。

本仓库包含前端应用源码、Amazon 图片策划逻辑、Prompt 模板、知识文档、本地启动脚本和部署配置，采用 [MIT License](LICENSE)。

需要注意：

- Codex / Claude Code / OpenClaw 只是可选的安装助手，不是项目运行依赖；不用 AI 编程工具也可以按下面的手动方式本地运行。
- 在线体验和本地应用都不会内置 API Key。生成图片和 AI 策划需要使用者填写自己的 OpenAI、火山方舟或兼容接口 Key，并自行承担调用费用。
- `package.json` 中的 `"private": true` 仅用于防止误发布到 npm，不会自动改变 GitHub 仓库的可见性或许可证。

## 更新日志

按自然周（周一至周日）整理，最新一周在最上方。每个周块可展开查看本周推送内容，提交号用于回溯具体改动。

<details open>
<summary><strong>2026-09-07 至 2026-09-13</strong> - Amazon Planner 用户上传模板图</summary>

- Amazon Planner 视觉风格区域新增“**不想用色卡？上传模板图**”入口；内置色卡式模板不再是唯一选择，用户上传后会立即替换当前模板，旧模板不会参与正式生图。
- 用户模板支持自适应预览、重命名、删除和本地模板库持久化，默认名称依次为“我的模板图”“我的模板图1”“我的模板图2”；删除当前用户模板后自动切回“清爽科技”。
- 上传模板会复用现有参考图压缩规则：优先压缩到最长边 1024px、质量 0.82 的 WebP；超过 8MiB 时再压缩到最长边 768px、质量 0.72，保持原始比例且本地只保存压缩结果。
- 用户模板图只在正式附图和 A+ 生图时作为最后一张隐藏风格参考图加入请求，MAIN 主图不会附加；模板图也不会发送给 AI 策划模型作为产品参考图。
- 切换模板会清理旧的模板图片 ID、色板和风格描述，并同步刷新已填入的 Planner 提示词、待提交任务分类和策划历史恢复状态。
- 提交：随本次提交发布。

</details>

<details>
<summary><strong>2026-08-31 至 2026-09-06</strong> - 图片编辑分辨率兼容性修复与多分辨率提示</summary>

- 图片编辑页新增 1K 输出档位，并始终保留首页生图的 1K/2K/4K 选项；使用 `gpt-image-2` 基础模型时默认选择 1K，避免默认向仅支持 1K 的模型发送 2K/4K 尺寸导致报错。
- 按已知模型能力选择默认档位：`gpt-image-2-2k`、`gpt-image-2-4k` 和 Seedream Pro 默认使用对应原生档位，同时允许其他接口手动选择其支持的分辨率。
- 首页编辑在 1K 默认接口上手动选择 2K/4K 时显示 Codex 能力反代的兼容性提示，不阻止其他接口使用其实际支持的更高档位。
- 修复图片编辑历史尺寸恢复时的分辨率档位判断，并补充 1K 尺寸与模型适配回归测试。
- 本地版保留“安装为应用”入口，但安装前会提示后续每次启动仍需先打开 `start-amazon-image-studio.bat`，保持本地服务运行。
- 提交：`df2be95`、`cb88f05`。

</details>

<details>
<summary><strong>2026-08-17 至 2026-08-23</strong> - 风格色板可读性与图片编辑体验优化</summary>

- 视觉风格卡片和编辑面板不再只显示 `C1–C6` 色块与 HEX：每个颜色现在会标注背景、辅助、强调、文字、中性或高亮等中文用途，并显示便于记忆的近似中文色名与精确 HEX 值。
- 风格编辑器增加 C1–C6 预览图例，字体、光影和材质选项改为中文名称优先；英文方向仍作为发送给模型的实际描述，不写入隐藏风格参考图。
- 图片编辑工作区的参考图增加始终可见的右上角移除按钮；参考图标签、删除按钮和前后移动控制改为深色高对比浮层，在白色、白金色或深色图片上都能清楚识别。
- 提交：随本次 `main` 推送发布。

</details>

<details>
<summary><strong>2026-08-03 至 2026-08-09</strong> - 阿里云百炼 Qwen-Image 3.0 Pro 接入</summary>

- 生图配置无需新增服务商选项：在“OpenAI 兼容接口”中填写 DashScope/MaaS API URL（例如 `https://dashscope.aliyuncs.com/api/v1` 或业务空间专属域名）和 API Key，应用会自动识别阿里云地址并切换到百炼原生多模态生图协议。
- 模型留空或仍为默认 `gpt-image-2` 时自动使用 `qwen-image-3.0-pro`，也可显式填写；请求隐式开启 `prompt_extend: true`，输出固定为 PNG。
- 原生接口支持 1–6 张结果和最多 3 张参考图，不支持遮罩编辑；界面会按接口能力隐藏质量、压缩率、审核参数，并在亚马逊工作台与上传入口按 3 张参考图上限校验。
- 百炼返回的临时图片 URL 有效期约 24 小时，应用会立即下载并保存到本地；开发服务、Docker 与 Nginx 的图片代理白名单同步加入 `aliyuncs.com` / `aliyun.com`，跨域图片可正常下载。
- 提交：随本次 `main` 推送发布。

</details>

<details>
<summary><strong>2026-07-27 至 2026-08-02</strong> - AI 人物媒体 XMP 打标</summary>

- 新增独立“AI 人物打标”工作区，在浏览器本地为 JPG/JPEG、PNG、WebP、MP4、MOV 写入 Amazon 要求的 `contains-synthetic-performer` XMP 标记，支持单文件下载或多文件 ZIP。
- 处理只修改 XMP/容器元数据，不重编码图片像素或音视频流；写入前会先验证现有 XMP，已正确包含标记的文件不会重复写入或打包。
- 单文件最大 500 MB、单批最大 1 GB；队列中的图片/视频预览完全在浏览器内完成，原文件不会被覆盖，也不会上传服务器。
- 提交：`679618f`。

</details>

<details>
<summary><strong>2026-07-20 至 2026-07-26 · v0.2.0</strong> - iOS 视觉重构、Seedream 图片编辑与开源声明</summary>

- 工作台完成 iOS / Apple 风格视觉重构，统一浅色、深色、桌面和移动端的导航、卡片、弹层、菜单、Toast 与底部操作区。
- 新增独立“图片编辑”工作区，支持从本地图片或历史结果开始编辑，添加参考图、绘制框选/箭头/涂画等视觉标注，并使用 Seedream 5.0 Pro 执行添加、删除、替换、改色、换材质和草图渲染。
- 设置页新增独立 Seedream 图片编辑配置，不改变首页图片生成连接；编辑结果可以继续设为主图并迭代处理。
- 顶部新增“开源声明”常驻入口；关于页和 README 增加开源与第三方收费说明、官方仓库核验入口及 Issues 举报入口，不改变 MIT License 的商业使用授权。
- 版本号由 `0.1.0` 提升至 `0.2.0`。
- 提交：`edf05e8`、`68408bb`、`0cba8d8`、`465a1ff`、`868f9e5`。

</details>

<details>
<summary><strong>2026-07-13 至 2026-07-19</strong> - AI 策划结果兼容性修复</summary>

- 修复部分模型把 `packageIncludes` 返回为数组时触发的 AI 策划解析报错。
- 加强商品标题、品牌、类目、颜色、材质、受众和包装清单等模型返回字段的类型校验与规范化。
- `packageIncludes` 为数组时会过滤无效项并合并为可读文本，异常字段不再直接调用字符串方法。
- 提交：`dc142f0`。

</details>

<details>
<summary><strong>2026-07-06 至 2026-07-12</strong> - 多站点 AI 策划、API 配置模式与流式传输移除</summary>

- 亚马逊图片工作台新增目标站点选择，支持美国站、日本站、德国站、法国站、意大利站和西班牙站。
- AI 策划会按目标站点输出本地化图片可见文案和 A+ 外部文案，生图提示词主体继续保持英文以提高模型稳定性。
- 策划历史、任务分类、任务详情和历史搜索会保留目标站点；旧历史和旧备份缺少站点字段时默认按美国站处理。
- A+ 模块尺寸继续沿用当前应用模板，相关策划文案改为“当前应用尺寸参考”，避免误认为已维护每站独立官方尺寸。
- API 配置页新增“标准双配置 / 反代或 OpenRouter 单连接”模式切换，默认继续使用独立的生图配置和 AI 策划配置。
- 单连接模式只需要维护一个当前连接的 API URL / API Key，AI 策划单独保存接口类型和模型，适合同一套反代或 OpenRouter 同时支持生图和聊天策划的场景。
- 单连接模式会隐藏内部 `AI策划` 元配置，不再把它显示在“当前连接”列表里，避免误以为还要维护两套 URL/Key。
- URL 参数导入保持兼容：普通 `apiUrl/apiKey` 只导入主连接，只有显式带 `apiSetupMode=single-connection` 时才恢复单连接和策划模型设置。
- 因部分反代或网关在流式生图时会返回 `upstream did not return image output` 等错误，移除流式传输入口，并忽略旧配置或分享链接中的流式参数。
- 提交：随本次 `main` 推送发布。

</details>

<details>
<summary><strong>2026-06-15 至 2026-06-21</strong> - 自定义策划数量、A+ 模块编排与提示词分辨率</summary>

- Listing AI 策划支持自定义图片数量，默认仍为 7 张，可在 `7-12` 张之间选择，数量包含 `MAIN` 主图。
- A+ 策划前可在右侧“模块编排”中逐行添加同尺寸模块、删除模块，并可恢复当前 A+ 类型默认编排；每个 A+ 类型支持 `1-12` 张模块。
- A+ 自定义模块数量会进入 AI 策划请求，schema、系统提示词、用户提示词、Chat JSON guide 和结果校验都会按当前模块清单执行。
- 生图最终提示词会自动追加期望输出分辨率，例如 `2048x2048` 或 `4096x4096`，让模型在提示词层面也知道目标尺寸。
- Agent 批量生图和图片工具调用同步加入输出分辨率约束，减少生成尺寸和当前参数脱节。
- 本地开发版不再内置 API 代理；如需同源代理，请使用 Docker/Nginx 等部署端代理配置。
- 开发代理会在 API URL 与本地代理目标一致时自动启用，降低本地 HTTP/内网接口配置成本。
- 提交：随本次 `main` 推送发布。

</details>

<details>
<summary><strong>2026-06-08 至 2026-06-14</strong> - 可编辑风格图、A+ 类型扩展、移动端操作窗与 DeepSeek 策划兼容</summary>

- 视觉风格新增可编辑预设和“我的风格”库，用户可从内置风格派生色板、字体、光影、材质和信息密度，并作为隐藏参考图参与附图和 A+ 生图。
- 风格编辑窗口保留英文方向作为实际参考内容，同时为字体方向、光影方向和材质方向增加中文说明，便于理解但不写入最终风格参考图。
- A+ 策划类型统一为普通A+、标准A+、高级A+、手机A+；新增手机A+ 5 张 `600x450` 模块，适合移动端短屏阅读。
- 移动端生成操作悬浮窗支持收起到左侧或右侧，收起后可通过贴边小标签展开，减少遮挡图片预览和底部输入区。
- AI 策划检测到 `https://api.deepseek.com` 时自动跳过参考图，仅发送纯文本 Chat Completions 请求，避免 DeepSeek 官方接口因 `image_url` 报错。
- 补充 DeepSeek 策划配置说明，明确官方 Chat Completions 当前不接收参考图。
- DeepSeek Chat Completions 和 Responses 策划统一按纯文本模型处理，增加反脑补约束，并在设置页和 Amazon 面板提示用户补齐产品关键特征。
- 补充 Vercel 体验版调用 HTTP API 的 HTTPS 安全策略提示。
- 提交：`8927ad1`、`8a42d09`、`b2ab475`，以及本次可编辑风格图更新。

</details>

<details>
<summary><strong>2026-06-01 至 2026-06-07</strong> - OpenRouter、参考图压缩与策划体验</summary>

- OpenRouter 生图改走 Chat Completions 图片生成，修复普通 Images API 路径下的 404。
- OpenRouter 请求补齐 `image_config.aspect_ratio` 和 `image_config.image_size`，A+ 非 1:1 图片会映射到最接近的支持比例，减少实际输出回落到 1024 级别。
- 视觉风格支持内置预设和可编辑“我的风格”，附图和 A+ 生成时会作为隐藏参考图参与最终生图。
- 风格板生成新增“停止”按钮，并把停止信号接入 OpenRouter、OpenAI Images API、自定义接口和 fal 请求链路。
- 参考图请求前会压缩、控尺寸并校验负载，修复大参考图导致的 413。
- 普通生图限制为 Images API，OpenRouter 图片模型保留兼容入口，避免误用不支持生图的配置。
- README 增加在线体验说明，Windows 启动脚本会在启动前自动检查并安装依赖。
- 优化 Amazon Planner 引导、API 默认配置、图片编辑流程、A+ 策划规则、风格控制和合规提示。
- 提交：`dd63338`、`9cdecd0`、`dc5e54d`、`031069d`、`56be7df`、`bff26ca`、`7d13774`、`ed43bf5`、`73c70f4`。

</details>

<details>
<summary><strong>2026-05-25 至 2026-05-31</strong> - Amazon 策划工作流、知识规则与本地化</summary>

- 大幅更新 Amazon Planner 工作流，强化 Listing 图片和 A+ 图片的策划、选择和生成流程。
- 调整图片默认参数、历史记录字段、任务展示和分类继承逻辑。
- 更新 dev proxy、mock image API、接口兼容测试和参数兼容逻辑。
- 内置 Amazon 图片规范、附图策划逻辑和 A+ 尺寸知识文档。
- 策划接口会引用内置知识规则，提高 Listing / A+ 策划稳定性。
- 项目名称统一调整为“亚马逊图片工作台”，同步页面标题、PWA manifest、启动脚本和界面文案。
- README 增加更完整的本地安装、启动和交付说明，历史记录搜索栏增加清理能力。
- 优化 Amazon Planner 工作流说明、Listing 图片策划模板、复制逻辑和相关测试。
- 提交：`a85312c`、`7c231bf`、`899532d`、`5cc09c4`、`0c8b9ec`、`d1de756`、`81a3fbd`、`3778620`。

</details>

<details>
<summary><strong>2026-05-18 至 2026-05-24</strong> - 项目初始化、部署配置与 A+ 模板</summary>

- 完成项目初始化，包含前端应用、图片生成、图片编辑、历史记录、设置页、PWA、代理和部署基础配置。
- 配置 GitHub Pages 工作流，并支持 main 分支推送后部署。
- 更新部署文档、安装路径说明和项目 GitHub 链接。
- 完善 README 使用说明。
- 优化 A+ Planner 模板、模块文案和任务历史展示。
- 默认关闭流式输出，降低默认配置复杂度。
- 提交：`ab63d9b`、`78ef9ea`、`3826fbc`、`ae118af`、`94c5cca`、`d929bdc`、`5860ddd`、`93f9585`、`f9198cb`。

</details>

## 在线体验

- 上游版本体验地址：[https://ali-aria.github.io/amazon-image-studio/](https://ali-aria.github.io/amazon-image-studio/)；当前版本请打开自己的 Cloudflare 部署地址。
- 打开在线体验不需要 Codex；Codex 只是一种可选的本地安装方式。
- 在线体验不会内置 API Key；生成图片和 AI 策划都需要在右上角设置中填写你自己的 OpenAI 或兼容接口 Key。
- “安装为应用”也可以用于本地版，但它不会自动启动本地服务；以后每次启动本地应用前，请先运行项目目录中的 `start-amazon-image-studio.bat`。
- API Key 保存在当前浏览器本地，不会提交到仓库；如果线上页面加载异常，也可以按下面的“启动项目”在本地运行。
- 💡 提示：若需调用非 HTTPS 的内网或本地 HTTP API，请使用 GitHub Pages 版本或自行部署，Vercel 部署的体验版绑定的 .dev 域名因安全策略通常要求接口必须为 HTTPS。

## 核心功能

- AI 策划 Listing 图片：支持美国、日本、德国、法国、意大利和西班牙目标站点；粘贴标题、五点描述或产品说明后，默认生成 `MAIN + PT01-PT06` 共 7 张图片，也可自定义为 `7-12` 张。
- AI 策划 A+ 图片：支持 `普通A+ / 标准A+ / 高级A+ / 手机A+` 四套 A+ 模块编排，策划前可按行添加或删除同尺寸模块。
- 参考图上传：支持上传产品实拍图、包装图、结构图，生成时会作为产品参考图一起发送。
- 模板图上传：内置模板主要提供色卡和基础视觉方向。如果你不想使用色卡式模板，可以上传一张喜欢的图片作为替代模板。上传后会替换当前模板，旧模板不会参与生图；用户模板只在附图和 A+ 正式生图时作为最后一张隐藏风格参考图使用，MAIN 主图不会附加。
- 视觉风格选择：内置预设和“我的风格”会直接显示 C1-C6 的中文用途、近似色名和精确 HEX；编辑面板提供预览图例，便于把参考图色块对应到实际颜色。用户模板支持自适应预览、重命名、删除和历史恢复，上传时会自动压缩并保持原始比例。
- 逐张生成：在右侧选择 `MAIN`、`PT01`、`A+L01`、`A+S01`、`A+P01`、`A+M01` 等图片位后，当前 Prompt Preview 会切换到对应提示词。
- Amazon 合规提示：主图白底、商品占比、禁用 Amazon/Prime/价格/评价/Best Seller 等风险元素。
- 支持 2K / 4K 输出；Listing 图默认方图，A+ 图按模块比例生成高清图，并显示 Seller Central 上传建议尺寸。
- 最终生图提示词会自动写入当前期望输出分辨率，让提示词和尺寸参数保持一致。
- A+ 小方块模块支持单独输出标题/正文文案，和图片内文字分开，避免把长文案画进 220x220 图片里。
- 支持 OpenAI / OpenAI 兼容图片接口、火山方舟 Seedream 图片生成、独立 AI 策划 Chat Completions / Responses API 配置，也支持反代或 OpenRouter 单连接模式复用同一套 URL/Key。
- 历史记录支持按商品、来源、形状筛选；从历史记录复用或编辑 Listing / A+ 图片时，新任务会继承原商品分类。
- 图片编辑工作区支持主图、最多 4 张参考图、框选/箭头/涂画标注、撤销重做和 Seedream Pro 编辑；参考图标签与操作按钮使用深色高对比浮层，浅色产品图上也能清楚识别和删除。
- 保留原项目的参考图、遮罩编辑、历史记录、批量下载、本地 IndexedDB 存储等能力。
- 新增独立“AI 人物打标”工作区：在浏览器本地为 JPG/JPEG、PNG、WebP、MP4、MOV 写入 Amazon 要求的 `contains-synthetic-performer` XMP 标记，并支持单文件下载或多文件 ZIP。

## 环境要求

推荐在 Windows 上使用。

需要先安装：

- Node.js 20 LTS 或更新版本
- npm

安装完成后，可以在 PowerShell 或命令行中检查：

```powershell
node --version
npm --version
```

## 首次安装

首次安装只需要做一次。下面两种方式二选一即可；如果已经让 AI 工具完成安装并启动，就不要再重复执行手动安装。

### 方式一：Codex / Claude Code / OpenClaw 安装并启动

如果你要把项目发给别人使用，最简单的方式是直接发 GitHub 仓库链接：

```text
https://github.com/Atomic994/amazon-image-studio
```

对方可以在 Codex、Claude Code、Claw Code 或其它 AI 编程工具里粘贴下面这段话：

```text
请把这个 GitHub 项目安装到我的本地电脑并启动：
https://github.com/Atomic994/amazon-image-studio

要求：
1. 先确认本机已经安装 Node.js 20 LTS 或更新版本和 npm。
2. 如果本地还没有项目，就 clone 仓库；如果已经下载 ZIP 或源码文件夹，直接进入现有项目目录，不要重复下载。
3. 在项目目录运行 npm ci 安装依赖。
4. 如果我是 Windows 用户，优先检查仓库里的 start-amazon-image-studio.bat，能用的话帮我用它启动项目；停止时可以用 stop-amazon-image-studio.bat。
5. 如果不使用 bat 脚本，就运行 npm run dev 启动项目。
6. 告诉我浏览器应该打开哪个本地地址。
```

如果 AI 工具不会自动执行命令，也可以让它按下面“方式二：手动安装（通用）”和“启动项目”里的命令一步一步带你操作。Windows 用户可以优先双击 `start-amazon-image-studio.bat` 启动；脚本会在首次启动或依赖变更后自动安装依赖，停止时双击 `stop-amazon-image-studio.bat`。项目启动后，每个使用者都需要在页面右上角设置里填写自己的 API Key；不要把你的 API Key 发给别人。

### 方式二：手动安装（通用）

先把仓库下载到本地：

```powershell
git clone https://github.com/Atomic994/amazon-image-studio.git
cd amazon-image-studio
```

如果你已经下载了 ZIP 或复制了源码文件夹，直接在终端进入你自己的项目目录即可。

安装依赖：

```powershell
npm ci
```

依赖只需要安装一次。以后日常使用直接看下面的“启动项目”。

## 启动项目

### 方式一：手动启动（通用）

在项目目录中执行：

```powershell
npm run dev
```

然后打开终端中显示的本地地址，通常是：

```text
http://127.0.0.1:5173/
```

停止时，在运行开发服务的终端中按 `Ctrl + C`。

### 方式二：双击启动（Windows 可选）

仓库根目录包含 Windows 便捷脚本：

```text
start-amazon-image-studio.bat
```

双击后会启动本地开发服务，并自动打开浏览器：

```text
http://127.0.0.1:5173/
```

如果服务已经在运行，脚本会直接打开浏览器。

首次双击或 `package-lock.json` 发生变化后，脚本会先运行 `npm ci` 安装依赖；依赖安装成功后才会启动项目。如果电脑还没有安装 Node.js 20 LTS 或更新版本，脚本会提示先安装 Node.js。

## 停止项目

手动启动时，在终端中按 `Ctrl + C` 即可停止。

如果使用 Windows 双击脚本启动，也可以双击：

```text
stop-amazon-image-studio.bat
```

脚本会停止当前项目对应的本地开发服务。如果 5173 端口被其它程序占用，脚本不会强行关闭无关进程。

## API 配置

打开页面后，点击右上角设置图标，进入 API 配置。

默认使用“标准双配置”：生图配置和 AI 策划配置各自独立。这样最兼容旧教程，也避免图片接口模型和文本策划模型混在一起。只有使用同一套 OpenAI 兼容反代或 OpenRouter 时，才建议在设置页顶部切换到“反代或 OpenRouter 单连接”。

### 1. 生图配置

生图配置用于真正生成图片。

- 服务商：OpenAI 兼容接口、fal.ai 或火山方舟 Seedream
- API 接口：`Images API (/v1/images)`
- 模型：`gpt-image-2`
- API Key：填写你自己的 Key

OpenRouter 生图模型不提供 OpenAI `/images/generations` 路径，应用会自动把 `https://openrouter.ai/api/v1` 的生图请求转到 `/chat/completions` 并发送 `modalities`。OpenRouter 示例：API URL 填 `https://openrouter.ai/api/v1`，模型填支持图片输出的模型，例如 `google/gemini-2.5-flash-image`；API 接口选择 `Images API` 或 `Chat Completions` 都可以。遮罩编辑仍需使用支持 `/images/edits` 的接口。

火山方舟 Seedream 示例：服务商选择“火山方舟 Seedream”，API URL 保持默认 `https://ark.cn-beijing.volces.com/api/v3`，API Key 填 Ark Key，模型默认 `doubao-seedream-5-0-pro-260628`。该接入只用于 Seedream 图片生成；Pro 模型会按官方示例使用 `image` 字段、`2K/4K` 尺寸和单图生成处理；如手动改用 Lite 模型 `doubao-seedream-5-0-260128`，参考图会以 JSON `image_urls` 发送，输出格式仅发送 PNG/JPEG。不使用遮罩编辑、AI 策划、视频、流式输出或联网搜索。如果界面参数选择 WebP，提交前会自动按 JPEG 处理。Pro 模型建议保持“返回 Base64 图片数据”关闭；当火山图片 URL 不允许浏览器跨域下载时，本地开发服务和 Docker/Nginx 部署会通过同源 `/image-proxy/` 自动下载。

阿里云百炼 Qwen-Image 3.0 Pro 不需要新增服务商选项：在现有“OpenAI 兼容接口”配置中填写 DashScope/MaaS API URL（例如 `https://dashscope.aliyuncs.com/api/v1` 或业务空间专属域名）、API Key 后，应用会自动识别阿里云地址并切换到百炼原生多模态生图协议。模型留空或仍为默认的 `gpt-image-2` 时，会自动使用 `qwen-image-3.0-pro`；也可以显式填写该模型。请求会隐式开启 `prompt_extend: true`，输出固定为 PNG，支持 1–6 张结果和最多 3 张参考图；原生接口不支持遮罩编辑。百炼返回的临时图片 URL 有效期约 24 小时，应用会立即下载并保存到本地；如遇跨域，开发服务和 Docker/Nginx 会通过同源 `/image-proxy/` 下载。

流式传输功能已移除。部分反代或网关在流式生图时会返回 `upstream did not return image output` 等错误，当前版本所有生图请求都会按非流式方式发送；旧分享链接中的 `streamImages` / `streamPartialImages` 参数会被忽略。

### 2. AI 策划配置

用于根据 Listing 生成 `MAIN + PT01...` 或 A+ 模块图片策划。

- 在“标准双配置”模式下，选择一个独立的 AI 策划配置
- API URL / API Key：填写文本模型服务商的地址和 Key
- API 接口：`Chat Completions (/chat/completions)`；OpenAI 官方也可继续使用 `Responses API (/v1/responses)`
- 模型：文本/多模态模型，例如 DeepSeek 使用 `deepseek-v4-flash`

DeepSeek 示例：API URL 填 `https://api.deepseek.com`，API 接口选择 `Chat Completions (/chat/completions)`，模型填 `deepseek-v4-flash`。当前 DeepSeek 官方 Chat Completions 接口只接收文本内容，本项目检测到该地址时会自动跳过参考图，仅用 Listing 文本做 AI 策划。

CLIProxyAPI / Codex 中转示例：API URL 填中转地址并保留 `/v1`，接口选择 `Chat Completions`，模型填中转实际提供的名称，例如 `gpt-6-sol` 或 `gpt-6.1-sol`。AI 策划默认使用流式请求，兼容仍返回普通 JSON 的中转；只有接口明确拒绝流式时才切换到非流式。图片生成的传输方式保持原有设置。

### 3. 反代 / OpenRouter 单连接模式

如果你的反代或 OpenRouter 同一套 API URL / API Key 同时支持生图和聊天策划，可以在设置页顶部把 API 配置模式切到“反代或 OpenRouter 单连接”：

- 当前配置里只填写一次 API URL / API Key，并设置生图接口和生图模型
- AI 策划配置区域只设置“策划接口”和“策划模型”
- 策划请求会复用当前配置的 URL / Key / 超时等连接信息，但不会复用生图模型
- 设置页不会把内部 `AI策划` 元配置显示在“当前连接”列表里

如果当前配置不是 OpenAI 兼容连接，单连接模式不会强行复用，AI 策划会回退到独立策划配置。此时请切回“标准双配置”，或把当前配置换成 OpenAI 兼容接口。

OpenRouter 等 Chat Completions 图片服务也可以把同一个 Chat 配置同时作为当前生图配置和 AI 策划配置。

AI 策划提示词已内置精炼版亚马逊图片知识库规则，包括 Listing 主图/附图规范、A+ 模块尺寸、移动端可读性和合规禁用项。原始知识库 Markdown 保存在 `docs/knowledge/` 作为规则来源备查，运行时不会把整篇原文发送给模型。

## 使用流程

1. 启动项目并打开页面。
2. 在设置中配置生图 API 和 AI 策划 API。
3. 在 Amazon 面板顶部选择 `Listing 图` 或 `A+ 图`。
4. 如果选择 `Listing 图`，可在顶部选择本次策划图片数量，默认 7 张，范围为 7-12 张。
5. 如果选择 `A+ 图`，默认使用 `普通A+`，也可以切换为 `标准A+`、`高级A+` 或 `手机A+` 编排，并在右侧模块清单里添加、删除或恢复默认模块。
6. 在策划输入框中粘贴产品标题、五点描述、产品说明或品牌说明。
7. 在“参考图”区域上传产品实拍图、包装图或结构图。
8. 如果不想使用内置色卡式模板，在视觉风格区域点击“**不想用色卡？上传模板图**”并选择图片；上传后会自动替换当前模板，也可以预览、重命名、切换或删除。
9. 点击 `AI策划` 或 `AI策划A+`，生成逐张方案；用户模板图不会作为产品参考图发送给 AI 策划模型。
10. 在右侧选择要生成的图片位，例如 `MAIN`、`PT01`、`A+L01`、`A+S01`、`A+P01` 或 `A+M01`。
11. 检查 Prompt Preview，必要时调整左侧商品信息。
12. 点击“填入”把当前提示词填到底部输入栏，或点击“提交生成”直接开始生成。
13. 生成完一张后，继续选择下一张图片位逐张生成；附图和 A+ 会将当前模板图作为最后一张隐藏风格参考图，MAIN 不会附加模板图。

## 视觉风格与图片编辑

视觉风格卡片下方会列出六个颜色的对应关系。`C1` 到 `C6` 不是需要记忆的英文单词，而是固定的设计角色：背景底色、柔和辅助色、主强调色、深色文字 / 对比色、中性色和高亮点缀色。每个颜色同时显示近似中文色名和 HEX，HEX 是复用颜色时的精确依据。

点击内置风格的“编辑”或编辑“我的风格”时，色板输入区会实时显示同一套用途和颜色名称；右侧预览下方的图例可以把预览图中的 `C1–C6` 对应回编辑项。字体、光影和材质选项以中文说明为主，输入框中的英文方向仍会作为实际模型提示词发送。

内置模板主要提供色卡和基础视觉方向。如果你不想使用色卡式模板，可以上传一张喜欢的图片作为替代模板。上传后会替换当前模板，旧模板不会参与生图。用户模板只作为配色、光影、材质和整体视觉质感参考，不复制原图文字、布局、产品或场景；上传图片会在本地压缩后保存，保持原始比例。

正式生图时，选中的内置、用户自定义风格图或用户上传模板图会作为最后一张隐藏参考图追加到附图和 A+ 请求；`MAIN` 主图不会附加风格图。用户上传模板图不会发送给 AI 策划模型。

顶部“图片编辑”工作区可以上传主图并添加参考图。每张参考图右上角都有移除按钮，底部的前移 / 后移按钮用于调整参考图顺序；这些操作浮层采用深色半透明样式，白色、白金色和深色图片都能保持清晰对比。

首页与图片编辑页之间切换会保留当前 AI 策划、选中的图片位、视觉风格和页面滚动位置。图片编辑支持独立工作区：A 图提交生成后，可用“添加下一张”或“从历史添加”打开 B/C 图，各自填写要求和标注后继续提交；切换缩略图可查看每张的进度、结果和失败重试。每张图的草稿和任务关联独立保存，不会被其他图片的生成任务锁住，刷新后也可恢复编辑工作区。

刷新和恢复策划历史后，参考图会按保存的图片 ID 重新读取实际原图。启动与删除任务时的图片清理会保留策划历史、模板库和所有编辑工作区正在引用的图片；提交前会验证并补齐原图记录，缺失时明确提示，不会将缺少参考图的请求悄悄作为纯文本生图提交。

## AI 人物媒体打标

顶部的“AI 人物打标”工作区用于处理已经确认需要披露的 AI 生成人物媒体。它不会识别人物、判断是否由 AI 生成，也不会调用生图 API；工具会先验证现有 XMP，只对尚未正确包含标记的文件执行写入。

使用方式：

1. 打开顶部“AI 人物打标”。
2. 拖入或选择 JPG/JPEG、PNG、WebP、MP4、MOV 文件，可一次加入多个文件。
3. 点击“一键写入 XMP 标记”。工具会逐个写入并读回验证 `XMP dc:subject` 中的 `rdf:Bag/rdf:li`。
4. 单个成功文件会保持原文件名直接下载；多个成功文件会下载一个 ZIP，失败文件会留在列表中并显示原因。

处理完全在当前浏览器/PWA 内完成，原文件不会被覆盖，也不会上传到服务器。队列中的图片显示本地缩略图，视频显示本地首帧预览；这些预览只使用临时对象 URL，不会保存。图片像素和视频流不会被重新编码；工具只修改 XMP/容器元数据。

开始处理前会先验证文件现有 XMP。如果已经在 `dc:subject/rdf:Bag` 中包含唯一且结构正确的目标标记，该文件会显示“已包含标记，不输出”，不会改写、下载或加入批量 ZIP，避免视频重复追加 XMP 数据。

首版支持单文件不超过 500 MB、单批不超过 1 GB。已有扩展 XMP、非标准 XMP 或损坏容器会安全失败，不会用不完整的替代结果覆盖原文件；更大的视频可以继续使用本地桌面版标记器。

写入的值是 Amazon 要求的精确关键词：`contains-synthetic-performer`。它位于 XMP `dc:subject` 的 `rdf:Bag` 中，而不是文件名、可见水印或普通文本字段。

## A+ 图片说明

普通A+ 当前默认编排，也是 A+ 图片策划的默认选项：

- `A+L01` Header Banner：上传建议 `970x300`
- `A+L02-A+L05` Single Image：上传建议 `970x600`

标准A+ 编排：

- `A+S01` Header Banner：上传建议 `970x300`
- `A+S02-A+S04` Single Image：上传建议 `970x600`
- `A+S05-A+S08` Highlight Tile：上传建议 `220x220`

高级A+ 编排：

- `A+P01` Hero Banner：上传建议 `1464x600`
- `A+P02-A+P04` Feature Image：上传建议 `970x600`
- `A+P05-A+P06` Brand Story：上传建议 `463x625`

手机A+ 编排面向移动端短屏阅读，默认 5 张 4:3 图片：

- `A+M01` Mobile Hero：上传建议 `600x450`
- `A+M02-A+M05` Mobile Feature：上传建议 `600x450`

A+ 策划前可以在右侧模块编排中调整数量：点击某一行的加号会在该行后添加同尺寸、同类型模块；点击删除会移除该模块；“恢复默认”会回到当前 A+ 类型的默认编排。每个 A+ 类型最少 1 张，最多 12 张。AI 策划完成后的结果列表保持只读，如需修改数量，请重新调整模块后再次 AI 策划。

A+ 生图会按模块比例请求 2K / 4K 高清画布，页面中会同时显示“生成尺寸”和“上传建议尺寸”。`Highlight Tile` 会额外生成可复制的 A+ 标题/正文文案；这些外部文案不会写入图片生成 Prompt。当前版本不自动裁切、压缩到 2 MB，也不默认生成 Logo 图或对比图。

## 安全说明

- 不要把你的 API Key 提交到 GitHub。
- 不要把包含 API Key 的配置截图发给别人。
- 本项目的 API Key 保存在你自己浏览器的本地存储中。
- 每个使用者应填写自己的 API Key，并自行承担 API 调用费用。
- 如果你要把项目发给别人，请确认仓库中没有 `.env`、私钥、真实 API Key 或个人数据。

## 常见问题

### 启动后打不开页面

确认是否已经安装依赖：

```powershell
npm ci
```

然后重新运行：

```powershell
npm run dev
```

Windows 用户也可以重新双击 `start-amazon-image-studio.bat`。

### 5173 端口被占用

如果是手动启动，先在终端中按 `Ctrl + C`。如果是 Windows 脚本启动，可以双击：

```text
stop-amazon-image-studio.bat
```

如果仍然提示被占用，说明 5173 可能被其它程序使用，需要先关闭对应程序，或改用 Vite 输出的其它端口。

### AI 策划失败

检查“AI 策划配置”是否使用了文本接口，并确认模型不是图片生成模型。DeepSeek 请使用 `Chat Completions (/chat/completions)`；当前 DeepSeek 官方接口不接收参考图，本项目会自动跳过参考图。部分图片中转接口只开放 `/v1/images`，不支持聊天或 Responses 接口，这种情况下 AI 策划会失败。

遇到 `HTTP 504: openai_error`、502/503、限流或流式连接中断时，应用会在配置的超时预算内最多请求 3 次（首次请求 + 2 次重试），以 1 秒、2 秒间隔重试；有 `Retry-After` 时优先使用该值，最多等待 30 秒。认证错误、无效请求、模型输出截断和 JSON 格式错误会直接显示详情。等待、接收和重试期间都可以点击“停止”，未完成的结果不会写入策划历史。

策划状态行右侧的“查看日志”可展开本次运行记录，显示耗时、请求次数、接口响应、已接收字符数、已接收方案数、重试原因和最终结果；完成、失败或停止后仍能查看和复制日志。最近接口数据时间与最近策划内容时间分别记录，便于分辨仅保活与持续输出。AI 分析阶段仅在接口返回对应信号时显示。日志保留在当前页面，新一次策划会重新记录；复制内容不包含请求 Key 或模型分析正文。

策划一次需要返回多张图的中文说明、英文提示词和负面提示词，通常比短对话耗时更长。原先强制 `stream: false`，中转要等整套结果生成完才返回，容易触发网关的读取或空闲超时。[OpenAI 流式文档](https://developers.openai.com/api/docs/guides/streaming-responses)说明了长输出的流式传输方式。当前 Cloudflare 配置只托管前端静态资源，策划请求由浏览器直接发送到 API URL；网站部署在 Cloudflare 不代表 504 一定来自网站的 Worker，还需检查 CPA 上游及其反向代理。

如果更新后仍有超时，请检查 CLIProxyAPI 服务端的 SSE 保活。根据 CPA 配置版本选择对应结构，以下配置用于中转服务器的配置文件，不是本项目的 `wrangler.jsonc`。

使用 `config-version: 8` 的 CPA：

```yaml
requests:
  streaming:
    keepalive-seconds: 15
    bootstrap-retries: 1
    send-keepalive-before-ft: true
```

使用旧版根级配置的 CPA：

```yaml
streaming:
  keepalive-seconds: 15
  bootstrap-retries: 1
  send-keepalive-before-ft: true
```

`send-keepalive-before-ft` 需要 CPA 版本支持，可在其[官方示例配置](https://github.com/router-for-me/CLIProxyAPI/blob/main/config.example.yaml)中核对；该项让中转在首个内容返回前也发送心跳。其他字段见[官方配置说明](https://help.router-for.me/configuration/options)。若使用 Nginx 或其他反向代理，还应关闭 SSE 响应缓冲，检查读取超时是否足够。单独增加网页里的超时无法延长中转或上游网关自己的超时限制；持续失败时请查看 CPA 请求日志，必要时减少单次策划张数。

### 生图失败

检查当前生图配置是否填写了正确的 API URL、API Key、模型和接口类型。生成图片建议使用 `Images API (/v1/images)` + `gpt-image-2`。

如果 OpenRouter 报 404，通常是旧版本请求到了 `/images/generations`。请更新后使用 `https://openrouter.ai/api/v1` 和带 `image` 输出能力的模型；OpenRouter 的图片生成实际走 `/chat/completions`。

如果反代返回 `upstream did not return image output`，通常是上游或网关没有返回可解析的图片结果。当前版本已移除流式传输入口，仍出现该错误时优先检查反代服务、上游账号和模型是否支持当前生图接口。

## 构建

如果需要生成生产构建：

```powershell
npm run build
```

构建产物在：

```text
dist/
```

## 静态部署

本项目是 Vite 单页应用，部署平台只需要安装依赖、运行构建命令，并把 `dist/` 作为静态目录发布。

如果使用仓库的 Docker/Nginx 部署并需要同源 API 代理，可设置 `ENABLE_API_PROXY=true` 和 `API_PROXY_URL`。OpenAI 官方通常使用 `API_PROXY_URL=https://api.openai.com/v1`；火山方舟 Seedream 使用 `API_PROXY_URL=https://ark.cn-beijing.volces.com/api/v3`，前端会请求同源 `/api-proxy/images/generations` 并由 Nginx 转发到 Ark `/api/v3/images/generations`。Docker/Nginx 还内置 `/image-proxy/`，用于下载火山返回但未开放 CORS 的图片 URL。

推荐配置：

```text
Install command: npm ci
Build command: npm run build
Output directory: dist
Node.js version: 22
```

### GitHub Pages

仓库已包含 GitHub Pages 工作流：

```text
.github/workflows/deploy.yml
```

使用步骤：

1. 进入 GitHub 仓库的 `Settings -> Pages`。
2. `Build and deployment` 的 `Source` 选择 `GitHub Actions`。
3. 推送到 `main` 后会自动构建并部署。也可以在 `Actions` 页面手动运行 `Deploy to GitHub Pages`，或推送 `v*` 格式的 tag，例如 `v0.1.0`。

项目的 Vite `base` 已设置为 `./`，可以部署在 `https://<username>.github.io/amazon-image-studio/` 这类子路径下。

GitHub Pages 部署后的地址格式：

```text
https://<username>.github.io/amazon-image-studio/
```

### Cloudflare（Workers / Pages）

#### 1. 部署方式与项目结构

本项目支持 **Workers 静态资源部署**和 **Pages 部署**，任选一种即可。已经部署成功的项目可以继续使用现有方式；查看 Cloudflare 的 `Workers & Pages` 项目列表即可确认项目类型。

Cloudflare 负责托管构建后的网页，AI 请求由浏览器直接发送到页面设置里的 API URL。当前配置无需额外部署应用后端或数据库，也无需把模型 API Key 写进仓库或 Cloudflare 构建变量；部署完成后在网页设置中填写连接信息。

在 GitHub 仓库中，以下文件直接位于根目录：

```text
amazon-image-studio/
├─ package.json        # 构建与部署命令
├─ package-lock.json   # 依赖锁定文件
├─ wrangler.jsonc      # Workers 静态资源配置
├─ src/                # 应用源码
└─ public/             # 静态资源
```

构建后生成 `dist/`。Cloudflare 的 **Root directory（根目录）留空，使用仓库根目录**；若界面要求填写，可填 `.`。不要填写电脑上的 `amazon-image-studio-main` 文件夹名，也不要把根目录设为 `src` 或 `dist`。

#### 2. 构建参数

| 配置项 | Workers 静态资源部署 | Pages 部署 |
| --- | --- | --- |
| GitHub 仓库 | `Atomic994/amazon-image-studio` | `Atomic994/amazon-image-studio` |
| 生产分支 | `main` | `main` |
| 项目名称 | `amazon-image-studio`，须与 `wrangler.jsonc` 的 `name` 一致 | 可自定义，例如 `amazon-image-studio` |
| 根目录 | 留空，使用仓库根目录 | 留空，使用仓库根目录 |
| Framework preset（框架预设） | 使用仓库现有 `wrangler.jsonc` | 有 Vite 则选 Vite；没有则选 None，手动填写下面的命令和目录 |
| Build command（构建命令） | `npm run build` | `npm run build` |
| Deploy command（部署命令） | `npx wrangler deploy` | 无需填写，由 Pages 发布构建产物 |
| Build output directory（构建输出目录） | 已在 `wrangler.jsonc` 的 `assets.directory` 中设置为 `./dist` | `dist` |
| 构建环境变量 | `NODE_VERSION` = `22` | `NODE_VERSION` = `22` |

Cloudflare 会自动安装项目依赖。Workers 的构建命令生成 `dist/`，随后部署命令读取 `wrangler.jsonc` 并上传静态资源；Pages 则直接发布配置的输出目录。本项目的 Workers 配置还启用了单页应用回退，以支持前端页面导航。Workers 控制台分别填写构建和部署命令即可，不需要把包含构建步骤的 `npm run deploy:cf` 再重复填入部署命令。参数定义见 [Workers 构建配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)和 [Pages Git 部署说明](https://developers.cloudflare.com/pages/get-started/git-integration/)。

#### 3. 在 Cloudflare 控制台部署

**连接 GitHub 仓库**

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)，选择自己的账号，进入 `Workers & Pages`。
2. 在连接 GitHub 时选择 `Atomic994` 账号，按提示安装或授权 `Cloudflare Workers and Pages` 应用。
3. 仓库授权可以选择 `Only select repositories`，并选中 `amazon-image-studio`。公开和私有仓库都可以用于部署；私有仓库需要保留这项读取授权。
4. 如已经安装过应用，可打开 [GitHub 应用安装设置](https://github.com/settings/installations)，找到 `Cloudflare Workers and Pages → Configure → Repository access`，确认该仓库已选中并保存。这里授权的是 Cloudflare 读取仓库，不需要把仓库改成公开。授权入口见 [Cloudflare GitHub 集成说明](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)。

**方式 A：Workers 静态资源部署**

1. 在 `Workers & Pages` 中点击 `Create application（创建应用）`，在 `Import a repository（导入仓库）` 旁点击 `Get started`。
2. 选择 GitHub 账号 `Atomic994`，再选择 `amazon-image-studio` 仓库。
3. 项目名称填写 `amazon-image-studio`，生产分支选择 `main`，根目录留空。若已有 Worker 使用其他名称，应先让仓库 `wrangler.jsonc` 中的 `name` 与已有项目名称一致。
4. 构建命令填写 `npm run build`，部署命令填写 `npx wrangler deploy`。本仓库已有静态资源配置，无需另外创建 Worker 脚本。
5. 在构建变量中添加 `NODE_VERSION`，值为 `22`。已有项目的入口通常为 `Settings → Build / Builds → Build Variables and Secrets`；这是构建环境版本设置。
6. 点击 `Save and Deploy（保存并部署）`，等待安装依赖、构建和发布完成。
7. 成功后打开控制台提供的 `https://amazon-image-studio.<你的子域名>.workers.dev` 地址，确认网页能正常加载。

已有 Worker 如需连接仓库，打开该项目的 `Settings → Build / Builds → Connect`，选择同一仓库并按上表配置即可。控制台名称与配置文件名称应保持一致，详见 [Workers Git 连接步骤](https://developers.cloudflare.com/workers/ci-cd/builds/)中的名称要求。

**方式 B：Pages 部署**

1. 在 `Workers & Pages` 中点击 `Create application → Pages → Connect to Git`。
2. 选择 GitHub 账号 `Atomic994` 和 `amazon-image-studio` 仓库，进入 `Begin setup`。
3. 填写 Pages 项目名称，生产分支选择 `main`，根目录留空。
4. 框架预设有 Vite 则选择 Vite，否则选择 None；构建命令填写 `npm run build`，构建输出目录填写 `dist`。
5. 在构建环境变量中添加 `NODE_VERSION`，值为 `22`；如分别显示 Production 和 Preview 环境，两边使用相同的版本。
6. 点击 `Save and Deploy`。部署完成后打开控制台提供的 `https://<你的 Pages 项目名称>.pages.dev` 地址，确认网页能正常加载。

部署页面的字段名称可能随控制台版本略有变化，以“构建命令、部署命令、输出目录、根目录”的含义对应填写。Node.js 版本设置可参考 [Workers 构建环境说明](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)。

### Vercel

当前仓库的 `vercel.json` 里关闭了 Git 自动部署：

```json
{
  "git": {
    "deploymentEnabled": false
  }
}
```

如果要让 Vercel 在每次 push 后自动部署，请删除这段配置，或把 `deploymentEnabled` 改为 `true`。如果继续保留它，可以使用 `.github/workflows/vercel-tag-deploy.yml` 中的 Deploy Hook 方式，并在 GitHub Secrets 里配置 `VERCEL_DEPLOY_HOOK`。

## 许可与来源

本项目源码以 [MIT License](LICENSE) 发布。开源范围包括前端源码、Prompt 模板、内置知识文档、本地启动脚本和部署配置；不包含 OpenAI、ChatGPT、Codex 或任何第三方模型服务本身，也不附带 API Key 或免费调用额度。

当前版本由 Atomic994 维护，基于 Ali-Aria 的亚马逊图片工作台版本继续修改；原始基础项目为 MIT 许可的 [GPT Image Playground](https://github.com/CookSleep/gpt_image_playground)，原作者为 CookSleep。

请保留应用内“关于”页中的原项目署名与 MIT 许可声明。
