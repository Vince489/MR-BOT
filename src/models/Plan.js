import mongoose from 'mongoose';

const { Schema } = mongoose;

const requiredArtifactSchema = new Schema({
  artifactType: {
    type: String,
    required: true,
    description: "Type of artifact expected (e.g., JSON schema, variable, confirmation code)"
  },
  validationCriteria: {
    type: String,
    required: true,
    description: "Criteria for validating the artifact"
  },
  validationTool: {
    type: String,
    description: "Tool to use for validation if applicable"
  }
});

const fallbackSchema = new Schema({
  action: {
    type: String,
    required: true,
    description: "Action to take if the step fails"
  },
  message: {
    type: String,
    required: true,
    description: "Message to display if the step fails"
  },
  recoverySteps: {
    type: [String],
    default: [],
    description: "List of step IDs to execute if this step fails"
  }
});

const stepSchema = new Schema({
  stepId: {
    type: String,
    required: true,
    unique: true,
    description: "Unique identifier for the step"
  },
  title: {
    type: String,
    required: true,
    description: "Title or name of the step"
  },
  description: {
    type: String,
    description: "Detailed description of the step"
  },
  tool: {
    type: String,
    required: true,
    description: "Tool to be used for this step"
  },
  dependencies: {
    type: [String],
    default: [],
    description: "IDs of steps that must be completed before this step can start"
  },
  requiredArtifact: {
    type: requiredArtifactSchema,
    required: true,
    description: "Definition of the artifact that must be produced and validated for this step to be complete"
  },
  fallback: {
    type: fallbackSchema,
    required: true,
    description: "Fallback actions to take if this step fails"
  },
  status: {
    type: String,
    enum: ["not_started", "in_progress", "completed", "failed"],
    default: "not_started",
    description: "Current status of the step"
  },
  startedAt: {
    type: Date,
    description: "Timestamp when the step was started"
  },
  completedAt: {
    type: Date,
    description: "Timestamp when the step was completed"
  },
  artifact: {
    type: Schema.Types.Mixed,
    description: "The artifact produced by this step"
  },
  validationResult: {
    type: Schema.Types.Mixed,
    description: "Result of validating the artifact"
  }
});

const planSchema = new Schema({
  planId: {
    type: String,
    required: true,
    unique: true,
    description: "Unique identifier for the plan"
  },
  title: {
    type: String,
    required: true,
    description: "Title or name of the plan"
  },
  description: {
    type: String,
    description: "Detailed description of the plan's purpose"
  },
  steps: {
    type: [stepSchema],
    required: true,
    description: "Steps in the plan"
  },
  currentStep: {
    type: String,
    default: "",
    description: "ID of the current step being executed"
  },
  status: {
    type: String,
    enum: ["not_started", "in_progress", "completed", "failed"],
    default: "not_started",
    description: "Overall status of the plan"
  },
  sessionId: {
    type: String,
    required: true,
    description: "Session ID this plan belongs to"
  },
  createdAt: {
    type: Date,
    default: Date.now,
    description: "Timestamp when the plan was created"
  },
  updatedAt: {
    type: Date,
    default: Date.now,
    description: "Timestamp when the plan was last updated"
  }
});

// Add indexes for better query performance
planSchema.index({ sessionId: 1 });
planSchema.index({ status: 1 });
planSchema.index({ "steps.status": 1 });

// Add pre-save hook to update the updatedAt field
planSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  if (typeof next === 'function') {
    next();
  } else {
    // Handle cases where next might not be a function
    return Promise.resolve();
  }
});

const Plan = mongoose.model('Plan', planSchema);

export default Plan;