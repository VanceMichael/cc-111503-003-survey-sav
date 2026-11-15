# 来源接口与资料语义

支持 little-endian $FL2、layout=2，compression=0 或 1；zlib=2、big-endian 和未知必需记录应明确不支持。记录类型2变量定义及 continuation(-1)、类型3/4值标签、类型7扩展13长名和20编码、999/0字典结束均按 PSPP sys-file 格式。字符串宽度1..255，超255不在本接收范围。missing_count 允许0..3及-2/-3。压缩流每组8个指令，0跳过、1..251解出code-bias、252结束、253取后续8字节、254空白、255系统缺失。保留 numeric 原始二进制与可表示数值，系统缺失不写成0。fixtures 的生成器同时产生普通、压缩、截断问卷。

## 收件器扩展接口

现有 `src/intake.mjs` 导出 `preview(source, store)`，只做预览。收件器入口为新增的 `collect(source, store)`，由调用方负责创建和关闭来源及 Inbox。`npm run acceptance` 调用这一入口。返回的 `records` 是可正式交付资料，不把未确认片段放进该集合；特殊业务的 pending 和 diagnostics 独立返回。原始证据通过 Inbox 保存，正式记录应含证据引用。接口不规定内部架构，允许增加模块和持久表，但不能移除原预览或更改来源语义。

## 可观察边界

- 长字符串 continuation 与长名扩展
- 缺失范围加额外缺失值
- 压缩指令组横跨问卷边界
- 声明未知行数与中途截断
- 值标签索引指向多个变量但不能重复消费记录

变量元数据的valueLabels为{value,label}数组，保留来源值标签原义；声明未知case计数时，以实际完整解码case为准。

## 公开的结果字段

`acceptance/collection.test.mjs` 给出当前集成方使用的结果字段及最小示例，说明的是输出契约而非内部处理步骤。除这些示例外，以上来源语义也属于功能范围，不能靠场景名称分支返回固定答案。`status` 仅在对应资料闭合且可靠取得时为 complete。
