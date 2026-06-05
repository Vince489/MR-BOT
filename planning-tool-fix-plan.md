# Planning Tool Fix Implementation Plan

## Current Situation Analysis

After careful review of the system and logs, I've identified the following key issues:

1. **Progress Tracking Conflict**: The `taskProgress` parameter is available in all tools, allowing the AI to mark steps complete before they're executed.

2. **Lack of Strict Sequencing**: The system doesn't enforce that steps must be completed in order with all dependencies satisfied.

3. **Incomplete Fallback Handling**: When operations return empty results, the system doesn't properly execute fallback actions.

4. **Premature Completion**: Steps are being marked complete in tool arguments before the tool actually executes.

## Root Cause

The fundamental issue is that progress tracking is distributed across multiple components rather than being centralized in the planning tool. This creates conflicts where:
- Tools can update progress independently
- The planning tool's state can become out of sync with actual execution
- There's no single source of truth for task completion

## Proposed Solution

### 1. Centralize Progress Authority in Planning Tool

**Objective**: Make the planning tool the exclusive authority for progress tracking.

**Implementation**:
```javascript
// In ToolExecutionManager.js
async executeToolCall(toolCall, actionsTaken, userInput, retryCount = 0, abortSignal) {
  const { name, arguments: rawArgs } = toolCall.function;
  const args = JSON.parse(rawArgs || "{}");

  // STRICT ENFORCEMENT: Only allow taskProgress in planning tool
  if (name !== 'managePlan' && args.taskProgress) {
    throw new Error(
      `Progress tracking violation: taskProgress can only be used with managePlan. ` +
      `Attempted to use in ${name}. Use managePlan to update progress.`
    );
  }
  // ... rest of method
}
```

### 2. Implement Step Validation and Sequencing

**Objective**: Ensure steps are executed in the correct order with all dependencies satisfied.

**Implementation**:
```javascript
// In Agent.js
async _validateStepExecution(planId, stepId) {
  // Get current plan state
  const planStatus = await this.tools.planningTool.handler({
    action: "getPlanStatus",
    planId: planId
  });

  if (planStatus.status !== "success") {
    throw new Error(`Unable to validate step: ${planStatus.message}`);
  }

  // Find the step
  const step = planStatus.steps.find(s => s.stepId === stepId);
  if (!step) {
    throw new Error(`Step ${stepId} not found in plan ${planId}`);
  }

  // Check if step is already completed
  if (step.status === "completed") {
    return { valid: true, message: "Step already completed" };
  }

  // Check if step is in progress
  if (step.status === "in_progress") {
    throw new Error(`Step ${stepId} is already in progress`);
  }

  // Verify all dependencies are completed
  const unmetDependencies = step.dependencies.filter(depId => {
    const depStep = planStatus.steps.find(s => s.stepId === depId);
    return !depStep || depStep.status !== "completed";
  });

  if (unmetDependencies.length > 0) {
    throw new Error(
      `Cannot execute step ${stepId}. ` +
      `Unmet dependencies: ${unmetDependencies.join(', ')}`
    );
  }

  return { valid: true, message: "Step ready for execution" };
}
```

### 3. Enhance Fallback Handling

**Objective**: Properly handle empty results and step failures.

**Implementation**:
```javascript
// In PlanningTool.js - enhance validateStep
async function validateStep(sessionId, stepId, artifact) {
  // ... existing validation code ...

  // Special handling for empty results
  if (validationResult.message &&
      (validationResult.message.includes("no results") ||
       validationResult.message.includes("empty"))) {

    step.status = "completed_with_warning";
    step.completedAt = new Date();
    step.artifact = { emptyResult: true, warning: validationResult.message };
    step.validationResult = validationResult;

    // Execute fallback if defined
    if (step.fallback) {
      return {
        status: "fallback_required",
        message: `Step ${stepId} completed with empty results. ` +
                 `Executing fallback: ${step.fallback.action}`,
        fallback: step.fallback,
        stepId: stepId,
        nextAction: step.fallback.action
      };
    }
  }
  // ... rest of method
}
```

### 4. Generate Progress from Plan State

**Objective**: Provide progress reporting based on actual execution state.

**Implementation**:
```javascript
// In Agent.js
async getCurrentProgress(planId) {
  try {
    const planStatus = await this.tools.planningTool.handler({
      action: "getPlanStatus",
      planId: planId
    });

    if (planStatus.status !== "success") {
      return {
        status: "error",
        message: "Unable to get plan status",
        progress: "- [ ] Task initialization"
      };
    }

    // Generate progress from actual plan state
    return {
      status: "success",
      progress: planStatus.steps.map(step => {
        const status = step.status === "completed" ||
                      step.status === "completed_with_warning" ? "x" : " ";
        return `- [${status}] ${step.title}`;
      }).join("\n"),
      planStatus: planStatus.planStatus,
      currentStep: planStatus.currentStep
    };
  } catch (error) {
    console.error("Error getting progress:", error);
    return {
      status: "error",
      message: error.message,
      progress: "- [ ] Error retrieving progress"
    };
  }
}
```

### 5. Update System Architecture

**Objective**: Modify the system to use the planning tool exclusively for progress.

**Changes Needed**:
1. Remove `taskProgress` from all tool definitions except `managePlan`
2. Add validation in `ToolExecutionManager` to reject improper progress updates
3. Update `Agent.js` to use planning tool for all progress tracking
4. Enhance error handling and fallback execution
5. Add comprehensive logging for debugging

## Implementation Plan

### Phase 1: Preparation
1. Create backup of current system state
2. Document current behavior for reference
3. Identify all components that use taskProgress

### Phase 2: Code Changes
1. Update `ToolExecutionManager.js` to enforce planning tool exclusivity
2. Modify `Agent.js` to validate step execution and use planning tool
3. Enhance `PlanningTool.js` with better fallback handling
4. Remove taskProgress from non-planning tool definitions

### Phase 3: Testing
1. Test with simple plans (1-2 steps)
2. Test with complex plans (dependencies, fallbacks)
3. Test error cases (invalid progress updates, out-of-order execution)
4. Verify progress reporting accuracy

### Phase 4: Deployment
1. Update system documentation
2. Deploy changes to production
3. Monitor system behavior
4. Address any issues that arise

## Risk Assessment

1. **Potential Risks**:
   - Breaking existing functionality that relies on taskProgress
   - Performance impact from additional validation
   - Complexity in error handling

2. **Mitigation Strategies**:
   - Comprehensive testing before deployment
   - Gradual rollout with monitoring
   - Clear error messages for debugging
   - Fallback to manual execution if planning tool fails

## Expected Outcomes

1. **Eliminated Conflicts**: Only one system controls progress
2. **Strict Sequencing**: Steps must be completed in order
3. **Better Validation**: Each step must be properly validated
4. **Improved Debugging**: Clear audit trail through planning tool
5. **More Reliable**: System state always matches actual execution

## Implementation Timeline

| Phase | Task | Estimated Time |
|-------|------|-----------------|
| 1     | Backup and documentation | 30 minutes |
| 2     | Code changes | 2 hours |
| 3     | Testing | 1 hour |
| 4     | Deployment and monitoring | 30 minutes |

## Files to Modify

1. `src/ToolExecutionManager.js` - Enforce planning tool exclusivity
2. `src/Agent.js` - Add step validation and progress reporting
3. `src/tools/PlanningTool.js` - Enhance fallback handling
4. `src/models/Plan.js` - Ensure proper plan state management
5. System prompt - Update instructions

## Verification Plan

1. **Unit Tests**:
   - Test progress validation
   - Test step sequencing enforcement
   - Test fallback execution

2. **Integration Tests**:
   - Test complete workflow execution
   - Test error scenarios
   - Test progress reporting

3. **Manual Testing**:
   - Execute sample migration task
   - Verify progress tracking accuracy
   - Test edge cases

This plan addresses the core issues while maintaining system stability. The key is to make the planning tool the single source of truth for progress tracking, which eliminates the conflicts we're seeing.