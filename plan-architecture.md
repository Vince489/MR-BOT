# Victor AI Agent Architecture Improvement Plan

## Overview
This document outlines the architectural improvements to Victor's thought tool and task progress system to address issues with progress hallucination, lack of validation, and poor error handling.

## Current Issues
1. **Progress Hallucination**: Tasks marked as complete before execution
2. **Lack of Validation**: No artifact verification before marking steps complete
3. **Poor Error Handling**: No structured fallbacks when operations fail
4. **Context Loss**: Empty context fields in thought records

## Solution Architecture

### Hybrid Tool Approach
- **thoughtTool**: Refocused on brainstorming and hypothesis formation
- **planningTool**: New execution governor with strict validation

### Key Components
1. **Planning Tool**: Enforces sequencing, validation, and fallback handling
2. **Validator System**: Modular validators for different artifact types
3. **State Machine**: Ensures steps execute in correct order
4. **Enhanced Debugging**: Clear visual indicators for plan state

## Implementation Plan

### Phase 1: Create Planning Tool Infrastructure
1. **PlanningTool.js**: Core tool implementation with validation logic
2. **Plan Model**: MongoDB schema for persistent plan storage
3. **Validator Classes**: Modular validation system

### Phase 2: Integrate with Agent
1. **Update Agent.js**: Add planning tool integration
2. **Modify Execution Flow**: Hybrid thought/planning approach
3. **Enhance Progress Tracking**: Replace narrative progress with state-based tracking

### Phase 3: Update Response Processor
1. **Add Plan Validation**: Verify plan structure before execution
2. **Enhance Tool Execution**: Integrate validation with tool results
3. **Improve Error Handling**: Structured fallback mechanisms

### Phase 4: Testing and Refinement
1. **Complex Task Testing**: Verify with multi-step scenarios
2. **Progress Tracking Validation**: Ensure accuracy of state reporting
3. **Fallback Testing**: Verify recovery paths work correctly

## Technical Details

### Planning Tool Schema
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PlanningTool",
  "type": "object",
  "properties": {
    "plan": {
      "type": "object",
      "properties": {
        "planId": {"type": "string"},
        "title": {"type": "string"},
        "steps": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "stepId": {"type": "string"},
              "title": {"type": "string"},
              "dependencies": {"type": "array", "items": {"type": "string"}},
              "requiredArtifact": {
                "type": "object",
                "properties": {
                  "artifactType": {"type": "string"},
                  "validationCriteria": {"type": "string"},
                  "validationTool": {"type": "string"}
                }
              },
              "fallback": {
                "type": "object",
                "properties": {
                  "action": {"type": "string"},
                  "message": {"type": "string"},
                  "recoverySteps": {"type": "array", "items": {"type": "string"}}
                }
              },
              "status": {"type": "string", "enum": ["not_started", "in_progress", "completed", "failed"]}
            },
            "required": ["stepId", "title", "dependencies", "requiredArtifact", "fallback"]
          }
        }
      },
      "required": ["planId", "title", "steps"]
    },
    "action": {
      "type": "string",
      "enum": ["createPlan", "updatePlan", "executeStep", "validateStep", "getPlanStatus", "handleFailure"]
    }
  },
  "required": ["action"]
}
```

### Execution Flow
1. User provides complex task
2. Agent uses thoughtTool for initial brainstorming
3. If task is multi-step, agent creates plan using planningTool
4. Agent executes steps according to plan dependencies
5. Each step result is validated before marking complete
6. Fallbacks are executed automatically if validation fails
7. Final response generated when all steps complete

## Benefits
1. **Eliminates Progress Hallucination**: Steps only marked complete after validation
2. **Enforces Sequencing**: Dependencies prevent out-of-order execution
3. **Improves Error Handling**: Structured fallbacks keep tasks moving
4. **Maintains Transparency**: Thought records still available for audit
5. **Preserves Flexibility**: Simple tasks can still use direct execution

## Risks and Mitigations
1. **Token Overhead**: Large plans may consume tokens
   - Mitigation: Store plan state in MongoDB, only include relevant portions in context

2. **Orchestration Complexity**: Potential for infinite loops
   - Mitigation: Enhance circuit breaker to monitor plan execution

3. **Validation Overhead**: Complex validation may slow execution
   - Mitigation: Implement lightweight validators for common cases

## Next Steps
1. Implement PlanningTool.js with strict validation logic
2. Create MongoDB Plan model
3. Update Agent.js for hybrid thought/planning execution
4. Enhance ResponseProcessor for plan validation
5. Test with complex multi-step scenarios