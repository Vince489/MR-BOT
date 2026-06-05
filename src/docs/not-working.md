# Analysis of Planning Tool Issue

## Problem Identification

From the logs, we can see that the planning tool is failing with the error:
```
[PLANNING TOOL] Error in createPlan: TypeError: next is not a function
    at model.<anonymous> (file:///C:/Users/Vince/Documents/MR-BOT/src/models/Plan.js:158:3)
```

This error occurs when trying to create a plan for the memory storage schema migration task.

## Root Cause Analysis

The error "next is not a function" typically occurs in Mongoose when there's an issue with middleware or pre-save hooks. Looking at the stack trace, it's happening in `Plan.js` at line 158.

The most likely causes are:

1. **Middleware Conflict**: There might be a conflict between different middleware functions or pre-save hooks in the Plan model.
2. **Schema Definition Issue**: The schema might have incorrect or conflicting definitions for pre-save hooks.
3. **Version Incompatibility**: There could be a version mismatch between Mongoose and the middleware library being used.

## Specific Issues in the Logs

1. **Duplicate Index Warning**:
   ```
   (node:10904) [MONGOOSE] Warning: mongoose: Duplicate schema index on {"planId":1} for model "Plan".
   ```
   This suggests there are multiple index definitions for the same field, which could cause issues.

2. **Plan Creation Attempts**:
   The system tries to create a plan twice with the same structure, and both attempts fail with the same error.

3. **Fallback to Manual Execution**:
   After the failures, the system correctly falls back to suggesting manual execution of the steps.

## Solution Recommendations

### 1. Fix the Mongoose Middleware Issue

The primary issue appears to be in `src/models/Plan.js` at line 158. We need to:

1. **Review the pre-save hooks**: Check for any hooks that might be calling `next` incorrectly.
2. **Check middleware registration**: Ensure middleware is being registered properly.
3. **Remove duplicate index definitions**: Fix the duplicate index warning which might be related.

### 2. Update the Plan Model

The Plan model should be updated to:

```javascript
const planSchema = new mongoose.Schema({
  planId: {
    type: String,
    required: true,
    unique: true,  // Use unique instead of index for simplicity
    index: true    // Keep only one index definition
  },
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  steps: [{
    stepId: String,
    title: String,
    description: String,
    tool: String,
    dependencies: [String],
    requiredArtifact: {
      artifactType: String,
      validationCriteria: String,
      validationTool: String
    },
    fallback: {
      action: String,
      message: String,
      recoverySteps: [String]
    },
    status: {
      type: String,
      enum: ["not_started", "in_progress", "completed", "failed"],
      default: "not_started"
    },
    startedAt: Date,
    completedAt: Date
  }],
  currentStep: String,
  status: {
    type: String,
    enum: ["not_started", "in_progress", "completed", "failed"],
    default: "not_started"
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Remove any duplicate pre-save hooks
// If you have multiple hooks, ensure they're properly chained
planSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next(); // Make sure next() is called properly
});

// Create the model
const Plan = mongoose.model('Plan', planSchema);
```

### 3. Update the Planning Tool Implementation

The PlanningTool.js should be updated to handle errors more gracefully:

```javascript
async function createPlan(planData) {
  try {
    // Validate plan structure first
    if (!planData.steps || !Array.isArray(planData.steps)) {
      throw new Error('Invalid plan structure: steps must be an array');
    }

    // Create a new Plan document
    const plan = new Plan(planData);

    // Save with error handling
    const savedPlan = await plan.save();

    return {
      status: 'success',
      planId: savedPlan.planId,
      plan: savedPlan.toObject()
    };
  } catch (error) {
    console.error('Error creating plan:', error);
    return {
      status: 'error',
      message: `Failed to create plan: ${error.message}`,
      error: error.message,
      stack: error.stack
    };
  }
}
```

### 4. Add Better Error Handling in Agent.js

Update the Agent's plan execution to handle failures more robustly:

```javascript
async _executePlanBasedTask(history, userInput, planSteps) {
  try {
    // Create a plan using the planning tool
    const planResult = await this._createInitialPlan(history, userInput, planSteps);

    if (planResult.status !== 'success') {
      console.error('Failed to create plan:', planResult.message);

      // Fallback to manual execution with progress tracking
      return this._executeManualWorkflow(history, userInput, planSteps);
    }

    // Execute the plan
    return this._executePlan(history, userInput, planResult.planId);
  } catch (error) {
    console.error('Error in plan-based execution:', error);
    return this.execute(history, userInput); // Fall back to standard execution
  }
}

async _executeManualWorkflow(history, userInput, steps) {
  // Implement a manual step-by-step execution with progress tracking
  let progress = [];
  let results = [];

  for (let i = 0; i < steps; i++) {
    const stepProgress = `- [ ] Step ${i+1}: ${this._getGenericStepTitle(i+1)}`;
    progress.push(stepProgress);

    const stepUserInput = `Execute step ${i+1}: ${this._getGenericStepTitle(i+1)} for task: ${userInput}`;

    // Execute the step
    const stepResult = await this.execute(history, stepUserInput);

    // Update progress
    progress[i] = progress[i].replace('[ ]', '[x]');
    const currentProgress = progress.join('\n');

    // Store results
    results.push({
      step: i+1,
      title: this._getGenericStepTitle(i+1),
      result: stepResult
    });
  }

  return {
    response: `Completed ${steps}-step workflow for: ${userInput}`,
    fullMessages: [...history, {
      role: "assistant",
      content: `Completed ${steps}-step workflow for: ${userInput}`
    }],
    stepResults: results
  };
}
```

## Testing the Fix

After implementing these changes, test the planning tool with:

1. A simple plan with 1-2 steps
2. A more complex plan with dependencies
3. Error cases (invalid plan structures)

## Additional Recommendations

1. **Add More Logging**: Enhance logging in the Plan model and PlanningTool to better diagnose issues.
2. **Validation**: Add schema validation before saving plans.
3. **Fallback Improvements**: Enhance the fallback mechanisms to handle different types of errors.
4. **Documentation**: Update the system documentation to reflect the proper usage of the planning tool.

## Example of Working Plan Creation

Once fixed, a proper plan creation should look like this in the logs:

```
[DEBUG] Tool Execution Details:
[DEBUG] Tool Name: managePlan
[DEBUG] Tool Arguments: {
  action: 'createPlan',
  plan: {
    planId: 'migration_20260503_2',
    title: 'Memory Storage Schema Migration',
    description: 'Migrate raw string entries to Weighted Vector Object format',
    steps: [...]
  },
  taskProgress: '- [ ] Define New JSON Schema\n- [ ] Search Existing Entries...'
}
[DEBUG] Tool Result: {
  status: 'success',
  message: 'Plan created successfully',
  planId: 'migration_20260503_2',
  plan: {...}
}
```

This would indicate the planning tool is working correctly and ready for execution.