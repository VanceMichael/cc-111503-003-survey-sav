# 社区调查系统文件的字典与问卷取值采集

Node.js 资料接收项目。项目保留来源原件，提供单次预览和系统文件收件采集。项目的用途是让接收方区分“能打开来源”和“已经可靠取得可交付资料”。

## 运行

运行时固定为 Node.js 22.23.4，npm 依赖由 package-lock.json 固定。准备阶段执行 `npm ci --ignore-scripts --no-audit --no-fund`；依赖准备完成后，运行和测试不联网。只使用本地生成资料和 loopback 来源，不需要生产账号。

`npm test` 验证当前预览、真实来源交互、收件存储及字典与数据解码边界。`npm run demo` 启动本地来源，执行一次真实预览并对各场景的问卷包执行真实收件，输出取得的内容和证据摘要后自动关闭。`npm run acceptance` 检查收件扩展接口的公开输出契约。功能改动应同时保留现有测试并通过收件检查，不能把新增检查改成跳过。

Linux 环境可用 `docker build -t survey-sav:local .` 预装依赖，然后 `docker run --rm --network none survey-sav:local` 验证底座。`docker run --rm --network none survey-sav:local npm run demo` 展示真实预览。所有测试来源在同一进程或容器内，network none 不限制容器 loopback。正式演示使用真实命令及完整输出，不回放日志；测试加预览的路径以90秒为上限。收件功能开发后的演示应在同一环境运行收件检查，不靠预设结果文本代替产品执行。

## 项目边界

来源和资料约定见 `docs/source-contract.md`，`acceptance/collection.test.mjs` 是集成方的公开输出契约。测试数据由来源模块或样本生成器提供，可修改参数添加边界，不能用公网真实业务数据替代。`src/store.mjs` 提供 SQLite 原件与收件记录存储，preview 本身不会声称已经完成业务接收。

## 收件采集

`src/intake.mjs` 的 `collect(source, store)` 解析 $FL2 字典与数据：原值（含数值原始二进制）、变量长名、选项标签和用户缺失定义一起保留；长字符串 continuation 合并为单一题目，不拆成多题；每条记录带证据引用与样本序号，每个字段带文件内字节偏移，可定位回原件。行数以实际完整解码的问卷为准，不采用头部声明代替。返回 `status` 区分 `complete`（闭合且可靠取得）、`incomplete`（尚不完整，已解码片段放入 `pending` 而非 `records`）、`unsupported`（格式不支持，含未知编码与超范围特性，不按猜测接收）；诊断独立返回，接收记录写入 Inbox 的 `collections` 命名空间。

数据文件写入可独立指定的 Inbox，测试默认用内存或临时目录。依赖目录、运行数据库与本机设置均不进入源码仓库。
