import Plan from '../models/Plan.js';
import { mongoDBConnection } from '../storage/MongoDBConnection.js';
import { ValidatorFactory } from '../validators/ValidatorFactory.js';
import mongoose from 'mongoose';

/**
 * Planning Tool
 *
 * A structured planning and execution tool that enforces strict sequencing,
 * artifact validation, and failure handling. This tool serves as the execution
 * governor for complex multi-step tasks.
 */
console.log('📋 [PLANNING TOOL] Initialized');

export const planningTool = {
  type: "function",
  function: {
    name: "managePlan",
    description: "Use this tool to create, update, and validate structured plans with strict sequencing and validation. " +
                 "This tool enforces that steps cannot be marked complete until their artifacts are validated. " +
                 "Use this for any task with 3 or more steps or when precise execution is required.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["createPlan", "updatePlan", "executeStep", "validateStep", "getPlanStatus", "handleFailure"],
          description: "The action to perform with the planningTool"
        },
        plan: {
          type: "object",
          description: "The plan structure to create or update",
          properties: {
            planId: { type: "string", description: "Unique identifier for the plan" },
            title: { type: "string", description: "Title of the plan" },
            description: { type: "string", description: "Description of the plan" },
            steps: {
              type: "array",
              description: "Steps in the plan",
              items: {
                type: "object",
                properties: {
                  stepId: { type: "string", description: "Unique identifier for the step" },
                  title: { type: "string", description: "Title of the step" },
                  description: { type: "string", description: "Description of the step" },
                  tool: { type: "string", description: "Tool to use for this step" },
                  dependencies: {
                    type: "array",
                    items: { type: "string" },
                    description: "Step IDs that must be completed before this step"
                  },
                  requiredArtifact: {
                    type: "object",
                    properties: {
                      artifactType: { type: "string", description: "Type of artifact expected" },
                      validationCriteria: { type: "string", description: "Criteria for validation" },
                      validationTool: { type: "string", description: "Tool to use for validation" }
                    }
                  },
                  fallback: {
                    type: "object",
                    properties: {
                      action: { type: "string", description: "Action to take if step fails" },
                      message: { type: "string", description: "Message if step fails" },
                      recoverySteps: {
                        type: "array",
                        items: { type: "string" },
                        description: "Step IDs to execute if this step fails"
                      }
                    }
                  }
                },
                required: ["stepId", "title", "tool", "dependencies", "requiredArtifact", "fallback"]
              }
            }
          },
          required: ["title", "steps"]
        },
        stepId: {
          type: "string",
          description: "The ID of the step to execute or validate"
        },
        artifact: {
          type: "object",
          description: "The artifact produced by a step for validation"
        },
        validationResult: {
          type: "object",
          description: "Result of validating an artifact"
        }
      },
      required: ["action"]
    }
  },
  handler: async (params) => {
    const {
      action,
      plan: planData,
      stepId,
      artifact,
      validationResult
    } = params;

    const sessionId = process.env.SESSION_ID;

    try {
      // Ensure MongoDB connection
      await mongoDBConnection.connect();

      switch (action) {
        case "createPlan":
          return await createPlan(planData, sessionId);

        case "validateStep":
          return await validateStep(sessionId, stepId, artifact);

        case "updatePlan":
          return await updatePlan(sessionId, planData);

        case "getPlanStatus":
          return await getPlanStatus(sessionId);

        case "handleFailure":
          return await handleFailure(sessionId, stepId);

        case "executeStep":
          return await executeStep(sessionId, stepId);

        default:
          return {
            status: "error",
            message: `Unknown action: ${action}`
          };
      }
    } catch (error) {
      console.error(`[PLANNING TOOL] Error in ${action}:`, error);
      return {
        status: "error",
        message: `Failed to ${action}: ${error.message}`,
        error: error.message
      };
    }
  }
};

/**
 * Create a new plan
 */
async function createPlan(planData, sessionId) {
  try {
    // Validate session ID
    if (!sessionId) {
      return {
        status: "error",
        message: "Session ID is required to create a plan"
      };
    }

    // Validate plan data structure
    if (!planData || typeof planData !== 'object') {
      return {
        status: "error",
        message: "Invalid plan data structure"
      };
    }

    // Generate unique plan ID
    const planId = `plan_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;

    // Set default values
    const plan = {
      ...planData,
      planId,
      sessionId,
      status: "not_started",
      currentStep: "",
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Validate plan structure
    if (!plan.steps || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      return {
        status: "error",
        message: "Plan must contain at least one step"
      };
    }

    // Set default status for all steps
    plan.steps = plan.steps.map(step => ({
      ...step,
      status: "not_started",
      startedAt: null,
      completedAt: null,
      artifact: null,
      validationResult: null
    }));

    // Create and save the plan
    const planDoc = new Plan(plan);

    // Save with error handling
    try {
      await planDoc.save();
      console.log(`📝 [PLANNING TOOL] Created plan ${planId} with ${plan.steps.length} steps`);

      return {
        status: "success",
        message: "Plan created successfully",
        planId: planId,
        plan: planDoc.toObject(),
        availableSteps: getAvailableSteps(planDoc)
      };
    } catch (saveError) {
      console.error(`[PLANNING TOOL] Error saving plan:`, saveError);

      // Provide more detailed error information
      let errorMessage = "Failed to save plan to database";

      if (saveError.name === 'ValidationError') {
        errorMessage = `Validation error: ${Object.values(saveError.errors)
          .map(err => err.message)
          .join(', ')}`;
      } else if (saveError.code === 11000) {
        errorMessage = `Duplicate key error: ${Object.keys(saveError.keyPattern).join(', ')}`;
      }

      return {
        status: "error",
        message: errorMessage,
        error: saveError.message,
        details: {
          planId: planId,
          stepCount: plan.steps.length,
          errorType: saveError.name,
          errorCode: saveError.code
        }
      };
    }
  } catch (error) {
    console.error(`[PLANNING TOOL] Unexpected error creating plan:`, error);
    return {
      status: "error",
      message: `Unexpected error creating plan: ${error.message}`,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    };
  }
}

/**
 * Validate a step's artifact and update status
 */
async function validateStep(sessionId, stepId, artifact) {
  if (!sessionId) {
    return {
      status: "error",
      message: "Session ID is required"
    };
  }

  if (!stepId) {
    return {
      status: "error",
      message: "Step ID is required"
    };
  }

  // Find the plan containing this step
  const planDoc = await Plan.findOne({
    sessionId: sessionId,
    "steps.stepId": stepId
  });

  if (!planDoc) {
    return {
      status: "error",
      message: `No plan found for session ${sessionId} containing step ${stepId}`
    };
  }

  // Find the specific step
  const step = planDoc.steps.find(s => s.stepId === stepId);
  if (!step) {
    return {
      status: "error",
      message: `Step ${stepId} not found in plan ${planDoc.planId}`
    };
  }

  // Check if step is already completed
  if (step.status === "completed") {
    return {
      status: "success",
      message: `Step ${stepId} is already completed`,
      stepStatus: step.status
    };
  }

  // Get validator for this step's artifact type
  const validator = ValidatorFactory.getValidator(step.requiredArtifact.artifactType);

  // Validate the artifact
  const validationResult = await validator.validate(artifact, step.requiredArtifact.validationCriteria);

  // Update step status based on validation
  if (validationResult.valid) {
    step.status = "completed";
    step.completedAt = new Date();
    step.artifact = artifact;
    step.validationResult = validationResult;
    console.log(`✅ [PLANNING TOOL] Step ${stepId} validated and completed`);
  } else {
    step.status = "failed";
    step.validationResult = validationResult;
    console.log(`❌ [PLANNING TOOL] Step ${stepId} validation failed: ${validationResult.message}`);

    // If there's a fallback, return it for execution
    if (step.fallback) {
      return {
        status: "fallback_required",
        message: `Step ${stepId} failed: ${validationResult.message}`,
        fallback: step.fallback,
        stepId: stepId
      };
    }
  }

  // Save the updated plan
  await planDoc.save();

  // Check if plan is now complete
  const allStepsCompleted = planDoc.steps.every(s => s.status === "completed");
  if (allStepsCompleted) {
    planDoc.status = "completed";
    await planDoc.save();
  }

  return {
    status: "success",
    message: `Step ${stepId} ${step.status}`,
    stepStatus: step.status,
    validationResult: validationResult,
    availableSteps: getAvailableSteps(planDoc),
    planStatus: planDoc.status
  };
}

/**
 * Update an existing plan
 */
async function updatePlan(sessionId, planData) {
  if (!sessionId) {
    return {
      status: "error",
      message: "Session ID is required"
    };
  }

  if (!planData.planId) {
    return {
      status: "error",
      message: "Plan ID is required for update"
    };
  }

  // Find and update the plan
  const planDoc = await Plan.findOneAndUpdate(
    { sessionId: sessionId, planId: planData.planId },
    {
      $set: {
        title: planData.title,
        description: planData.description,
        steps: planData.steps,
        updatedAt: new Date()
      }
    },
    { new: true }
  );

  if (!planDoc) {
    return {
      status: "error",
      message: `Plan ${planData.planId} not found for session ${sessionId}`
    };
  }

  console.log(`📝 [PLANNING TOOL] Updated plan ${planData.planId}`);

  return {
    status: "success",
    message: "Plan updated successfully",
    planId: planDoc.planId,
    availableSteps: getAvailableSteps(planDoc)
  };
}

/**
 * Get the current status of a plan
 */
async function getPlanStatus(sessionId) {
  if (!sessionId) {
    return {
      status: "error",
      message: "Session ID is required"
    };
  }

  // Find the most recent plan for this session
  const planDoc = await Plan.findOne({ sessionId })
    .sort({ createdAt: -1 })
    .limit(1);

  if (!planDoc) {
    return {
      status: "error",
      message: `No plan found for session ${sessionId}`
    };
  }

  return {
    status: "success",
    planId: planDoc.planId,
    planStatus: planDoc.status,
    currentStep: planDoc.currentStep,
    steps: planDoc.steps.map(step => ({
      stepId: step.stepId,
      title: step.title,
      status: step.status,
      dependencies: step.dependencies
    })),
    availableSteps: getAvailableSteps(planDoc)
  };
}

/**
 * Execute a step in the plan
 */
async function executeStep(sessionId, stepId) {
  if (!sessionId || !stepId) {
    return {
      status: "error",
      message: "Session ID and Step ID are required"
    };
  }

  // Find the plan containing this step
  const planDoc = await Plan.findOne({
    sessionId: sessionId,
    "steps.stepId": stepId
  });

  if (!planDoc) {
    return {
      status: "error",
      message: `No plan found for session ${sessionId} containing step ${stepId}`
    };
  }

  // Find the specific step
  const step = planDoc.steps.find(s => s.stepId === stepId);
  if (!step) {
    return {
      status: "error",
      message: `Step ${stepId} not found in plan ${planDoc.planId}`
    };
  }

  // Check if step is already completed or in progress
  if (step.status === "completed") {
    return {
      status: "error",
      message: `Step ${stepId} is already completed`
    };
  }

  if (step.status === "in_progress") {
    return {
      status: "error",
      message: `Step ${stepId} is already in progress`
    };
  }

  // Check if all dependencies are completed
  const uncompletedDependencies = step.dependencies.filter(depId => {
    const depStep = planDoc.steps.find(s => s.stepId === depId);
    return !depStep || depStep.status !== "completed";
  });

  if (uncompletedDependencies.length > 0) {
    return {
      status: "error",
      message: `Cannot execute step ${stepId}: dependencies not completed: ${uncompletedDependencies.join(", ")}`
    };
  }

  // Mark step as in progress
  step.status = "in_progress";
  step.startedAt = new Date();
  planDoc.currentStep = stepId;

  // Save the updated plan with transaction for concurrency control
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    await planDoc.save({ session });
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  }

  return {
    status: "success",
    message: `Step ${stepId} started`,
    stepStatus: step.status,
    nextAction: {
      tool: step.tool,
      requiredArtifact: step.requiredArtifact,
      instructions: `Please execute ${step.tool} to fulfill ${step.title}.`
    }
  };
}

/**
 * Handle a failed step by executing its fallback
 */
async function handleFailure(sessionId, stepId) {
  if (!sessionId) {
    return {
      status: "error",
      message: "Session ID is required"
    };
  }

  if (!stepId) {
    return {
      status: "error",
      message: "Step ID is required"
    };
  }

  // Find the plan containing this step
  const planDoc = await Plan.findOne({
    sessionId: sessionId,
    "steps.stepId": stepId
  });

  if (!planDoc) {
    return {
      status: "error",
      message: `No plan found for session ${sessionId} containing step ${stepId}`
    };
  }

  // Find the specific step
  const step = planDoc.steps.find(s => s.stepId === stepId);
  if (!step) {
    return {
      status: "error",
      message: `Step ${stepId} not found in plan ${planDoc.planId}`
    };
  }

  // Check if step has a fallback
  if (!step.fallback) {
    return {
      status: "error",
      message: `Step ${stepId} has no fallback defined`
    };
  }

  // Execute fallback actions
  console.log(`� [PLANNING TOOL] Executing fallback for step ${stepId}: ${step.fallback.action}`);

  // If there are recovery steps, mark them as available
  if (step.fallback.recoverySteps && step.fallback.recoverySteps.length > 0) {
    // Update status of recovery steps to not_started if they were failed
    for (const recoveryStepId of step.fallback.recoverySteps) {
      const recoveryStep = planDoc.steps.find(s => s.stepId === recoveryStepId);
      if (recoveryStep && recoveryStep.status === "failed") {
        recoveryStep.status = "not_started";
        recoveryStep.startedAt = null;
        recoveryStep.completedAt = null;
        recoveryStep.artifact = null;
        recoveryStep.validationResult = null;
      }
    }

    await planDoc.save();
  }

  return {
    status: "success",
    message: `Fallback executed for step ${stepId}`,
    fallback: step.fallback,
    availableSteps: getAvailableSteps(planDoc)
  };
}

/**
 * Determine which steps are available to execute next
 */
function getAvailableSteps(planDoc) {
  return planDoc.steps
    .filter(step => {
      // Step is not started and all dependencies are completed
      return step.status === "not_started" &&
             step.dependencies.every(depId => {
               const depStep = planDoc.steps.find(s => s.stepId === depId);
               return depStep && depStep.status === "completed";
             });
    })
    .map(step => ({
      stepId: step.stepId,
      title: step.title,
      tool: step.tool,
      requiredArtifact: step.requiredArtifact
    }));
}