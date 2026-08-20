# 日志规范约束

分级总则：【必须】违反必须修复／【应当】违反须列出理由／【建议】仅参考。

## 一、日志设施（非强约束）

- 【应当】项目有统一日志组件时优先使用，格式字段经组件统一配置。
- 无日志组件时按日志量评估选择：
  - 日志稀疏的脚本/工具：可直接用语言默认通道（`print` / `stdout` / `console.log`）。
  - 日志密集的服务/业务模块：【应当】自定义 log 宏/函数，命名参考 `LOG_WARN` 风格：`LOG_DEBUG` / `LOG_TRACE` / `LOG_INFO` / `LOG_WARN` / `LOG_ERROR` / `LOG_FATAL`。
- 【应当】日志内容包含可支持的字段，尽量向第二章标准格式对齐；确难获取的字段（如脚本的线程号、代码位置）可省略。
- 同一项目内日志方式的选择必须统一，并写入项目文档。

## 二、标准格式

单行标准格式：

```
{时间戳} | [{模块}] {级别} {函数名} {行号} tid:{线程号} {正文}
```

- **时间戳**：毫秒精度 `YYYY-MM-DD HH:MM:SS.mmm`
- **模块**：业务模块名，如 `[capture]`
- **级别**：见第三章
- **函数名 / 行号**：代码所属位置
- **线程号**：`tid:xxxx`，无线程概念可省略
- **正文**：英文描述，见第四章

完整示例：`2026-07-23 10:46:53.402 | [vision_guide] INFO restfulHandler 531 tid:973 reqUrl=GET /operation/system/time/get`

- 【必须】同一项目内格式统一：字段顺序、分隔符、时间格式不得混用（反例：混用 `2025-06-01` 与 `Jun-01, 2025` 两种时间格式）。

## 三、日志级别

由低到高：TRACE < DEBUG < INFO < WARN < ERROR < FATAL，按"≥ 配置级别"过滤输出。【必须】项目组件级别体系与此不同（如 TRACE 置于 INFO 之上）时，项目文档须写明过滤语义。

| 级别 | 使用场景 | 生产默认 |
|---|---|---|
| TRACE | 函数进出、细粒度路径跟踪 | 关闭 |
| DEBUG | 内部状态，供开发调试与测试定位 | 关闭；发布版本禁止默认开启 |
| INFO | 关键业务流的重要状态变更 | 开启 |
| WARN | 可恢复异常、非预期但可继续运行 | 必开 |
| ERROR | 操作失败、数据异常，系统仍可运行 | 必开 |
| FATAL | 关键功能失效，程序无法继续 | 必开，通常伴随退出 |

- 【必须】级别与语义相符：业务状态流转不降级为 DEBUG/TRACE，预期正常行为不升级为 WARN（反例：以 WARN 输出 `camera connected`）。

## 四、日志内容

### 4.1 正确性与完整性
- 【必须】如实反映行为；关键信息完备，不读源码也能看懂；错误日志含对象、操作、原因。
  - 正例：`failed to open camera 1, reason: timeout`；反例：`failed`。
- 【必须】禁止无意义输出（反例：仅打印 `event happens`）与无意义编号替代语义（`event 1`、`error 2`）。

### 4.2 语言与行文
- 【必须】正文用英文、首字母小写、结尾不加句点（反例：`Camera 1 connected.`）。
- 【必须】技术词汇拼写正确（反例：`crema diconnet`，应为 `camera disconnected`）。
- 【应当】键值日志键命名全项目统一（camelCase 或 snake_case），如 `camId=1 retryCount=3`。

### 4.3 简洁性与性能
- 【必须】禁止输出超大数据块（完整点云、整段 JSON）；大数据写入独立文件，日志只留摘要与指针。
  - 正例：`point cloud loaded, count=152340, dump=logs/pc_0001.bin`
  - 反例：`point cloud is {完整序列化内容...}`
- 【必须】禁止重复冗余输出（反例：矩阵每行元素前都打印完整时间戳；正例：单次时间戳 + 紧凑输出）。
- 【必须】热路径不做高开销参数求值（整体序列化、大对象 `toString`）；被关闭的级别不应触发参数计算。

### 4.4 安全
- 【必须】禁止输出密码、密钥、token、个人可识别信息；必要时脱敏后输出。

## 五、可观测性

- 【必须】生命周期事件始末成对，标识字段前后一致。
  - 正例：`start capture` / `stop capture`、`capture start camId=1` / `capture stop camId=1 costMs=320`
  - 反例：起止不成对，或同一状态重复打印多次。
- 【必须】多通道/多实例业务（多相机、多机器人）正文显式带业务标识且全程稳定。
  - 正例：`robot 1 move to target` / `robot 2 move to target`
  - 反例：`robot move to target`（无法区分通道）
  - 不得以线程号替代业务标识——线程调度不固定，无法关联始末。
- 【应当】事件始末标记与普通通知类日志语义区分明显（反例：事件进行中插入 `alarm to ui: camera 1 connect`，导致分析工具误判事件起点）。
- 【应当】分布式节点时间同步（NTP）；跨服务调用链用统一 `traceId` 关联。

## 六、正例与反例汇总

```
// 正例：级别准确、上下文完整、标识稳定
LOG_INFO("camera %d connect begin", camId)
LOG_INFO("camera %d connected", camId)
LOG_WARN("camera %d heartbeat lost, retryCount=%d", camId, retryCount)
LOG_ERROR("camera %d disconnected, reason=%s", camId, errMsg)

LOG_DEBUG("camera %d connected", camId)     // 反例：状态流转降级
LOG_INFO("something happened")              // 反例：语义不明
LOG_DEBUG("point cloud is %s", pc.toJson()) // 反例：大数据污染日志
```

## 七、项目适配

- 【应当】使用日志组件时启用标准格式的全部字段（时间戳、模块、级别、代码位置、线程号）。
- 组件格式枚举与标准字段的映射、项目的日志方式选择（组件 / 自定义宏 / 默认通道），写入项目扩展文档。
