# Factual Analysis of Planning Tool and Task Progress System

## Current System Behavior (Based on Code Review)

### 1. task_progress Parameter

**Location**: Defined in `ToolExecutionManager.js` (lines 69-76)

```javascript
// Add taskProgress as an optional property if not already present
if (!modifiedParameters.properties.taskProgress) {
  modifiedParameters.properties.taskProgress = {
    type: "string",
    description: "Markdown-formatted checklist to track task progress. " +
                "Each line should be a checklist item (e.g., '- [ ] Step 1'). " +
                "This parameter is optional and can be included in any tool call.",
    pattern: "^(\\s*(- \\[(x| )\\] .*)\\n?)*$"
  };
}
```

**Key Facts**:
- Added to ALL tool definitions automatically
- Optional parameter in every tool
- Uses markdown checklist format
- Pattern validation ensures proper format

### 2. Planning Tool Integration

**Location**: Defined in `src/tools/PlanningTool.js`

```javascript
export const planningTool = {
  type: "function",
  function: {
    name: "managePlan",
    description: "Use this tool to create, update, and validate structured plans...",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["createPlan", "updatePlan", "executeStep", "validateStep", "getPlanStatus", "handleFailure"]
        },
        // ... other parameters including taskProgress ...
      },
      required: ["action"]
    }
  },
  // ... handler implementation ...
};
```

**Key Facts**:
- Planning tool is one of several tools in the system
- Designed for structured, multi-step tasks
- Has its own taskProgress parameter (like all tools)
- Provides validation and sequencing capabilities

### 3. Execution Flow

**Location**: `ToolExecutionManager.js` (lines 116-129)

```javascript
// Extract taskProgress if present (before validation)
const taskProgress = args.taskProgress;
delete args.taskProgress; // Remove from args to avoid validation issues

// Reattach taskProgress to validated args if it was provided
if (taskProgress !== undefined) {
  validatedArgs.taskProgress = taskProgress;
}

// Parse and process taskProgress if present
if (taskProgress) {
  this._processTaskProgress(taskProgress, name, validatedArgs);
}
```

**Key Facts**:
- taskProgress is extracted before validation
- Processed separately from main tool arguments
- Reattached to validated arguments
- Sent to `_processTaskProgress` for logging/emitting events

### 4. Progress Processing

**Location**: `ToolExecutionManager.js` (lines 446-497)

```javascript
_processTaskProgress(taskProgress, toolName, args) {
  try {
    // Parse the markdown checklist
    const lines = taskProgress.split('\n').filter(line => line.trim());
    const progressItems = [];
    let completedCount = 0;
    let totalCount = 0;

    lines.forEach(line => {
      const trimmed = line.trim();
      const match = trimmed.match(/^\-\s*\[\s*([xX ])\s*\]\s*(.+)$/);
      if (match) {
        totalCount++;
        const status = match[1].toLowerCase() === 'x' ? 'completed' : 'pending';
        const description = match[2].trim();
        progressItems.push({ description, status, tool: toolName });
        if (status === 'completed') completedCount++;
      }
    });

    // Emit progress event
    if (this.enableEvents && progressItems.length > 0) {
      this.emit("task-progress", {
        tool: toolName,
        progress: progressItems,
        completed: completedCount,
        total: totalCount,
        percentage: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
      });
    }

    // Debug logging
    if (this.debug) {
      console.log(`[DEBUG] Task Progress for ${toolName}:`);
      console.log(`[DEBUG] Total items: ${totalCount}, Completed: ${completedCount}`);
      progressItems.forEach(item => {
        console.log(`[DEBUG] - [${item.status === 'completed' ? 'x' : ' '}] ${item.description}`);
      });
    }
  } catch (error) {
    // Log but don't fail
    if (this.debug) {
      console.log(`[DEBUG] Failed to parse taskProgress for ${toolName}:`, error.message);
    }
  }
}
```

**Key Facts**:
- Parses markdown checklist format
- Tracks completed vs pending items
- Emits progress events
- Provides debug logging
- Gracefully handles parsing errors

## The Actual Problem

After reviewing the logs and code, the issue is NOT that task_progress exists in all tools - that's by design. The problems are:

1. **Premature Completion Marking**:
   ```json
   // From logs - tool marking step complete BEFORE execution
   "taskProgress": "- [x] Define New JSON Schema\n" +  // ← Marked complete
                   "- [ ] Search Existing Entries\n"   // ← But hasn't run yet
   ```

2. **Lack of Synchronization**:
   - Planning tool tracks actual execution state
   - task_progress is being updated independently
   - No validation to ensure they match

3. **No Execution Validation**:
   - Steps can be marked complete without verification
   - No check that dependencies are satisfied
   - No validation of artifacts/outputs

## Recommended Solution

### 1. Add Progress Validation Layer

```javascript
// In Agent.js - add validation before tool execution
async _validateTaskProgress(planId, taskProgress, currentTool) {
  // Get actual plan state
  const planStatus = await this.tools.planningTool.handler({
    action: "getPlanStatus",
    planId: planId
  });

  if (planStatus.status !== "success") return taskProgress;

  // Parse provided task_progress
  const progressLines = taskProgress.split('\n');
  const completedInProgress = progressLines.filter(line =>
    line.includes('[x]') || line.includes('[X]')
  ).map(line => line.replace(/^\-\s*\[\s*[xX]\s*\]\s*/, '').trim());

  // Check each completed item against plan state
  for (const item of completedInProgress) {
    const matchingStep = planStatus.steps.find(step =>
      step.title === item || step.description.includes(item)
    );

    // If marked complete in progress but not in plan state, that's a problem
    if (matchingStep && matchingStep.status !== "completed") {
      console.warn(`[PROGRESS VALIDATION] Item "${item}" marked complete in progress ` +
                  `but is ${matchingStep.status} in plan state`);

      // For non-planning tools, we should correct this
      if (currentTool !== 'managePlan') {
        return this._generateProgressFromPlan(planStatus);
      }
    }
  }

  return taskProgress;
}
```

### 2. Synchronize Progress with Actual Execution

```javascript
// In Agent.js - modify execute method
async execute(history, userInput) {
  // For planned tasks, validate progress
  if (this._isPlannedTask(userInput)) {
    const planId = this._getCurrentPlanId();
    const toolCall = history[history.length-1].tool_calls[0];
    const toolName = toolCall.function.name;
    const args = JSON.parse(toolCall.function.arguments);

    if (args.taskProgress) {
      // Validate and potentially correct the progress
      args.taskProgress = await this._validateTaskProgress(
        planId,
        args.taskProgress,
        toolName
      );
      toolCall.function.arguments = JSON.stringify(args);
    }
  }

  // ... rest of execution
}
```

### 3. Enhance Planning Tool Validation

```javascript
// In PlanningTool.js - modify validateStep
async function validateStep(sessionId, stepId, artifact) {
  // ... existing validation ...

  // Only mark step complete if validation passes
  if (validationResult.valid) {
    step.status = "completed";
    step.completedAt = new Date();
    step.artifact = artifact;
    step.validationResult = validationResult;

    // Generate updated task_progress
    const updatedProgress = planDoc.steps.map(s => {
      const status = s.status === "completed" ? "x" : " ";
      return `- [${status}] ${s.title}`;
    }).join("\n");

    console.log(`✅ [PLANNING TOOL] Step ${stepId} validated and completed`);
    console.log(`[PROGRESS UPDATE]\n${updatedProgress}`);

    return {
      status: "success",
      message: `Step ${stepId} completed`,
      stepStatus: step.status,
      validationResult: validationResult,
      taskProgress: updatedProgress,  // Return updated progress
      availableSteps: getAvailableSteps(planDoc),
      planStatus: planDoc.status
    };
  }
  // ... error handling ...
}
```

## Implementation Plan

1. **Add Validation Layer**:
   - Create `_validateTaskProgress` method in Agent.js
   - Modify execute method to validate progress before execution

2. **Enhance Planning Tool**:
   - Improve validation in validateStep
   - Return updated task_progress after step completion
   - Add better error handling for empty results

3. **Update System Prompt**:
   ```text
   PROGRESS TRACKING RULES:
   1. task_progress should accurately reflect execution state
   2. Only mark steps [x] AFTER successful completion
   3. For planned tasks, progress will be validated against plan state
   4. Planning tool provides the authoritative progress state
   ```

4. **Testing Strategy**:
   - Test with simple and complex plans
   - Verify progress validation works
   - Test error cases and fallbacks
   - Ensure synchronization maintains accuracy

This solution maintains the existing design where task_progress is available in all tools, while adding the necessary validation and synchronization to prevent the issues we're seeing.