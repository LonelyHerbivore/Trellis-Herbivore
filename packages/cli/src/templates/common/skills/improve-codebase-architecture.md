---
name: trellis-improve-codebase-architecture
description: "Active codebase architecture analysis and review. Three modes: (A) Active Analysis — explore codebase, build spec, generate refactor candidates; (B) Pre-dev Guidance — provide architecture guidance before implementation; (C) Deep Review — audit changed code against spec after code-architecture-review passes."
---

# Trellis Improve Codebase Architecture

This skill operates in three modes depending on context. Read the dispatch prompt to determine which mode applies.

---

## Mode A: Active Analysis（主动分析）

**触发条件**：用户直接调用，dispatch prompt 中不含 `架构审查模式:`

### 流程

**第一步：检查活跃任务**

```bash
{{PYTHON_CMD}} ./.trellis/scripts/task.py current
```

- 有活跃任务 → 询问用户："当前有活跃任务 `[任务名]`，是否切换到架构分析任务？"
  - 用户拒绝 → 终止，不做任何操作
  - 用户同意 → 执行 `{{PYTHON_CMD}} ./.trellis/scripts/task.py finish` 结束当前会话，再继续
- 无活跃任务 → 直接继续

**第二步：询问分析范围**

让用户指定要分析的目录、模块，或整个代码库。根据项目结构给出建议范围。

**第三步：创建架构分析任务**

```bash
{{PYTHON_CMD}} ./.trellis/scripts/task.py create "架构分析: <scope>" --slug arch-analysis-<MMDD>
```

**第四步：通过 trellis-research 探索代码库**

dispatch `trellis-research` 子代理，探索指定范围，识别：

- 模块边界和依赖关系
- 现有的架构模式和开发风格
- 接口复杂度 vs 实现复杂度（shallow module 信号）
- 耦合点和测试困难区域

研究结果自动持久化到 `{TASK_DIR}/research/`，供后续步骤引用。

**第五步：Spec 驱动分析**

检查 `.trellis/spec/` 是否有相关规范：

**如果存在 spec**：
- 读取相关 spec 文档
- 以 spec 为评判标准分析代码
- 识别不符合 spec 的架构问题
- 生成编号的重构候选清单

**如果 spec 不存在或不完整**：
- 基于 `research/` 里的探索结果，识别现有模式和开发风格
- 与用户进行对话式讨论，每次只确认一个规范点
- 每确认一个规范点后，立即写入 `.trellis/spec/`（遵循现有 spec 格式，同步更新对应 `index.md`）
- 基于新建的 spec 给出候选清单

**第六步：输出候选清单**

将候选清单记录到任务 PRD 中：

```markdown
## 架构分析候选清单

1. **[模块名]** - 问题描述
   - 涉及文件：`path/to/file.ts`
   - 问题：[具体问题，如接口比实现复杂]
   - 建议：[改进方向]
   - 预期收益：[可维护性、可测试性等收益]
```

候选清单不是实现指令，需要用户选择后再创建具体实现任务。

---

## Mode B: Pre-dev Guidance（前置架构指导）

**触发条件**：dispatch prompt 中包含 `架构审查模式: guidance`

### 流程

1. 读取活跃任务的 `prd.md` 和 `design.md`
2. 读取 `.trellis/spec/` 中的相关规范
3. 基于 PRD 和 design 的内容，输出架构指导
4. 将指导内容追加到活跃任务的 `design.md`：

```markdown
## 架构指导（Pre-development）

### 模块边界建议
[基于 PRD 范围的建议]

### 关键抽象设计
[需要明确的接口和契约]

### 潜在架构风险
[可能导致结构漂移的设计决策]
```

### 禁止操作

- 不创建新的 Trellis 任务
- 不调用 `task.py create` 或 `task.py start`
- 不修改实现代码

---

## Mode C: Deep Review（深度审查）

**触发条件**：dispatch prompt 中包含 `架构审查模式: deep-review`

### 流程

1. 从 dispatch prompt 读取改动文件列表
2. 读取活跃任务的 `prd.md` 和 `design.md`（含 `## 架构指导` 段落，如有）
3. 读取 `.trellis/spec/` 中的相关规范
4. 审查改动代码，检查：
   - 是否遵循了 `design.md` 中的架构指导
   - 是否引入了不必要的抽象或中间层
   - 模块边界是否清晰
   - 是否产生了架构漂移（偏离 spec 或架构指导）
5. 输出审查报告

### 报告格式

```markdown
## 深度架构审查报告

**结论：通过 / 失败**

### 审查范围
- 改动文件：[列表]
- 对照标准：[spec 文件列表]

### 发现的问题
1. `<file>:<line>` - [问题描述]
   - 违反了：[spec 条目 / 架构指导段落]
   - 建议：[修改方向]

### 阻断性问题
[必须修复才能通过的问题，如无则写"无"]
```

**审查失败时**：报告阻断性问题，主 session 将把代码打回 `trellis-implement` 修改，并重新进入完整的 review 循环。

### 禁止操作

- 不创建新的 Trellis 任务
- 不调用 `task.py`
- 不直接修改实现代码
