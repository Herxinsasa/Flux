# 软件工程目录规范（AI 开发体系）

本规范只约定**目录结构与文档组织**；需求、架构、设计类文档统一提供模板（`templates/`），见第七节。

## 一、总则

- **适用范围**：新建 Git 仓库。既有项目在重大重构时对齐。
- **只规范 AI 开发体系**：md 格式、研发维护、随版本更新。不动原有交付体系。
- **扁平化**：目录层级 ≤ 4 层（含根目录），以命名区分职责，不靠目录深度。
- **AI 入口**：仓库根目录和每个子工程根目录**必须**有 `CLAUDE.md`。
- **技术栈中立**：根目录与 `docs/`、`scripts/`、`tools/` 为技术栈无关的共享区；子工程内部结构遵循各自技术栈的社区惯例。
- **文件名约定**：统一小写英文。单个完整单词不加分隔符（如 `errorcode.md`）；多词用 kebab-case（`xxx-xxx.md`）；允许常规缩写（如 `templ`）；`README.md`、`CLAUDE.md` 等约定俗成名除外。名字控短，能懂即可。
- **按需剪枝**：以上为中大项目的完整结构。小项目按实际情况裁剪——无 UI 设计则不建 `ui/`，无需求设计文档则不建 `design/`，模块无需细分则不建 `modules/`。没有内容就不建路径。

## 二、仓库根目录

```
<repo_root>/
├── .gitignore
├── README.md        # 工程入口：用途、构建、部署概览
├── CLAUDE.md        # AI 上下文入口（必填）
├── docs/            # 仓库级文档，见第三节
├── scripts/         # 仓库级通用脚本（ci/、sql/ 等按需建子目录）
├── tools/           # 工具与配置（格式化、lint、IDE 模板）
└── projects/        # 子工程集合，见第四节
```

## 三、仓库级文档（`docs/`）

描述本版本内跨子工程共享的内容：需求、需求设计、协议、指导、测试。随版本迭代，研发共同维护。

```
docs/
├── overview/        # architecture.md（架构、通信拓扑、设计约束）、directory-structure.md（本规范落地说明）
├── requirements/    # <迭代号>-<主题>-req.md，每次需求迭代一份（需求项、验收标准、依赖、待确认问题）
├── design/          # <迭代号>-<主题>-req-design.md，需求设计（客户端/服务端技术设计同文）
├── protocol/        # comm-protocol.md、data-format.md、errorcode.md（跨工程错误码分段）
├── ui/              # ui-spec.md、prototype/（设计稿截图，AI 可直接 Read）
├── guide/           # deploy-guide.md（部署/操作指导）等指导性文档
└── test/            # test-plan.md（策略、环境、冒烟清单）、test-report.md
```

- 文件按需创建，没有内容的分类不建空文件；空目录用 `.gitkeep` 占位。
- `design/` 放按需求迭代的需求设计文档；长期模块事实放各工程 `docs/modules/`，长期架构事实放 `overview/architecture.md`。
- 仓库级公共模块可按需在 `docs/modules/` 下建，格式同工程级 `modules/`。

## 四、子工程目录（`projects/<name>/`）

每个子工程是一个独立构建单元。本规范只强制三项：

```
projects/<name>/
├── README.md        # 子工程说明（必填）
├── CLAUDE.md        # AI 上下文入口（必填）
├── docs/            # 工程级文档，见第五节（必填）
└── ...              # 其余遵循技术栈社区惯例
```

各技术栈内部结构示例（不强制；私有实现统一在 `internal/` 下按模块细分）：

**C++ 子工程**

```
projects/vision_server/
├── README.md / CLAUDE.md
├── xmake.lua                # 构建脚本（或 CMakeLists.txt）
├── include/                 # 对外暴露的头文件
├── src/
│   ├── main.cpp
│   └── internal/            # 内部实现，不对外部子工程暴露
│       ├── module/          # 业务模块，每个模块一个目录（capture/、process/…）
│       ├── msg/             # 内部消息、协议定义
│       └── util/            # 内部工具函数
├── config/                  # 运行时配置
├── scripts/                 # 子工程专属脚本（打包、部署辅助）
├── test/                    # 测试
└── docs/
```

**Go 子工程**

```
projects/config_server/
├── README.md / CLAUDE.md
├── go.mod
├── cmd/
│   └── server/main.go       # 入口
├── internal/                # 私有实现，不可被外部引用
│   ├── module/              # 业务模块，每个模块一个目录
│   ├── msg/                 # 消息定义
│   └── service/             # 服务组装层
├── pkg/                     # 可对外复用的公共库
├── config/
└── docs/
```

**Web / Electron 子工程**

```
projects/web_client/
├── README.md / CLAUDE.md
├── package.json
├── src/
│   ├── pages/               # 页面/视图
│   ├── components/          # 组件
│   ├── stores/              # 状态管理
│   ├── api/                 # 后端请求封装
│   └── utils/
├── public/
└── docs/
```

新增子工程只在 `projects/` 下加目录，不改根目录结构。

## 五、工程级文档（`projects/<name>/docs/`）

面向本工程开发者与 AI，随代码高频更新，由开发人员维护。

```
docs/
├── overview/        # architecture.md（分层 + 状态机 + 流程图）、directory-structure.md（本工程目录约定）
├── spec/            # coding-spec.md（补充 CLAUDE.md）、errorcode.md（本工程专用）、test-spec.md（含单测策略）
└── modules/         # module-index.md（依赖关系 + 影响面速查）、<module-name>/README.md（模块设计文档：定位、对外接口、数据结构、核心流程、依赖）
```

## 六、CLAUDE.md 约定

| 位置 | 职责 |
|------|------|
| 仓库根目录 | 项目定位、技术栈总览、子工程清单（一句话职责）、仓库级文档地图 |
| 子工程根目录 | 本工程架构、关键约定、构建与运行入口、工程级文档地图 |

**原则**：根目录提供全局视野，子工程聚焦自身细节；信息不跨层重复。

## 七、文档模板

模板位于本规范同级的 `templates/`。创建以下文档时复制对应模板，保证格式统一：

| 文档 | 存放位置 | 模板 |
|------|---------|------|
| 需求规格（按需求迭代） | `docs/requirements/<迭代号>-<主题>-req.md` | `templates/requirement-spec-templ.md` |
| 需求设计（按需求迭代） | `docs/design/<迭代号>-<主题>-req-design.md` | `templates/req-design-templ.md` |
| 架构总览（长期） | `docs/overview/architecture.md`、`projects/*/docs/overview/architecture.md` | `templates/architecture-templ.md` |
| 模块设计（长期） | `projects/*/docs/modules/<module-name>/README.md` | `templates/module-design-templ.md` |

需求规格、需求设计为按需求迭代的一次性文档；架构总览、模块设计为长期文档，仅在长期事实变化时回写——一次性需求细节不得写入长期文档。

- 模板中 `[xxx]` 与"待补充"为占位符，须替换为实际内容；标注"如适用"的章节无则删除。
- 其余文档（test-plan、module-index、errorcode 等）不强制模板，写清第三节/第五节中的职责描述即可。
