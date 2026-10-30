# 任务跟踪：本地 Markdown

任务与规格存放在 `.scratch/`，按功能分目录。

## 文件约定

- 功能目录：`.scratch/<feature-slug>/`。
- 规格：功能目录下的 `spec.md`。
- 实现任务：`issues/<NN>-<slug>.md`，从 01 编号，每个任务单独一个文件。
- 评论与讨论：追加到文件末尾的 `## Comments` 下。

技能要求“发布到任务跟踪器”时，创建对应的本地文件；
要求“读取相关任务”时，读取指定路径的文件。

## Wayfinder 约定

- 任务地图：`.scratch/<effort>/map.md`，记录笔记、已有决策和待解决问题。
- 子任务：`issues/NN-<slug>.md`，正文记录待解决的问题。
- Type：research（研究）、prototype（原型）、grilling（质询）或 task（实现任务）。
- Status：open（待领取）、claimed（已领取）或 resolved（已解决）。
- 依赖：在文件顶部使用 `Blocked by: NN, NN`；所有依赖均已解决才可开始。
- 选择任务：按编号选择尚未领取、依赖已解决的任务。
- 领取任务：开始工作前保存 `Status: claimed`。
- 解决任务：在 `## Answer` 下追加答案，设置 `Status: resolved`，
  并向地图追加结论摘要及文件链接。
