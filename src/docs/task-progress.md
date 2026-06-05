# 🔧 The `task_progress` Parameter — Complete Breakdown

The `task_progress` parameter is a **structured checklist** I (as the AI agent) can attach to **any tool call** to track progress on a multi-step task in real-time. It gives both me and you visibility into where we are in the workflow.

---

## 📋 How It Works

### 1. Where It Lives
It's an **optional** parameter on almost every tool I use (read_file, write_to_file, replace_in_file, execute_command, search_files, etc.). Not all tools support it, but most do.

### 2. Format
It uses **standard Markdown checklist syntax**:

```
- [ ] Incomplete item
- [x] Completed item
```

### 3. Lifecycle

**Step 1 — Initial creation:** When I start a task, I define a todo list with all the steps I need to complete.

**Step 2 — Updates:** Every time I call a tool, I update the checklist:
- Mark items as `[x]` when done
- Add new items if discovered mid-task
- Reorder if needed

**Step 3 — Final delivery:** When I call `attempt_completion`, I include the final state of the checklist so you can see exactly what was accomplished.

---

## 🎯 Visual Example

Let me simulate a task like "Build a simple web page":

### Tool Call 1: Read existing file
```xml
<read_file>
  <path>index.html</path>
  <task_progress>
  - [x] Analyze requirements
  - [ ] Create HTML structure
  - [ ] Add CSS styling
  - [ ] Add JavaScript functionality
  - [ ] Test in browser
  </task_progress>
</read_file>
```
*(Marking step 1 complete since I've already analyzed what's needed)*

### Tool Call 2: Write the HTML file
```xml
<write_to_file>
  <path>index.html</path>
  <content>...</content>
  <task_progress>
  - [x] Analyze requirements
  - [x] Create HTML structure
  - [ ] Add CSS styling
  - [ ] Add JavaScript functionality
  - [ ] Test in browser
  </task_progress>
</write_to_file>
```

### Tool Call 3: Write the CSS file
```xml
<write_to_file>
  <path>style.css</path>
  <content>...</content>
  <task_progress>
  - [x] Analyze requirements
  - [x] Create HTML structure
  - [x] Add CSS styling
  - [ ] Add JavaScript functionality
  - [ ] Test in browser
  </task_progress>
</write_to_file>
```

### Final: Completion
```xml
<attempt_completion>
  <result>Web page created successfully</result>
  <command>open index.html</command>
  <task_progress>
  - [x] Analyze requirements
  - [x] Create HTML structure
  - [x] Add CSS styling
  - [x] Add JavaScript functionality
  - [x] Test in browser
  </task_progress>
</attempt_completion>
```

---

## 💡 Key Behaviors

| Aspect | Behavior |
|--------|----------|
| **Granularity** | Not too fine — e.g., "Install dependencies" not "Download react package, download express package..." |
| **Automatic reminders** | The system injects my current task_progress into future prompts so I stay on track |
| **Rewritable** | I can rewrite the entire list if scope changes or new steps are discovered |
| **Silent updates** | I update it without announcing — it's metadata, not conversation |
| **Allowed in both modes** | Works in PLAN MODE and ACT MODE |

---

## 🔍 Why It Exists

It prevents a common AI failure mode: **losing track of what's been done**. When I have a 10-step task and some steps take many tool calls, the checklist keeps me grounded. If I'm about to mark the task complete but the checklist shows 3 unchecked items, the system will flag that inconsistency.
