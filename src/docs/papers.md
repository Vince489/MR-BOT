There are multiple papers that introduce exactly what you are looking for, as a clear theme in recent research is moving LLMs away from free-form generation and toward structured, state-based outputs.

Below is a curated list of the most relevant papers, organized from the most direct match to closely related approaches.

### 🎯 The Core Paper
This document is the closest match to your specific request, as it directly introduces the concept of a **State Machine Framework (SMF)** for LLMs.

- **Title & Authors:** *Structure- and Event-Driven Frameworks for State Machine Modeling with Large Language Models* by Samer Abdulkarim, Evan Boyd, Karl Bridi, et al.
- **Core Concept:** This paper investigates the use of specialized State Machine Frameworks (SMFs) to fully automate the generation of UML state machines from unstructured natural language requirements.
- **Key Mechanisms:** It introduces two distinct SMFs:
    1.  **Structure-Driven SMF:** Generates state machine components (states, transitions, etc.) in sequential steps.
    2.  **Event-Driven SMF:** Uses identified events to iteratively guide the construction of the state machine.

### 📚 Related Frameworks & Applications
Several other important papers use state machines to structure LLM behavior, though their primary focus may differ slightly from pure modeling.

- **SHERPA: A Model-Driven Framework for LLM Execution**: This framework explicitly incorporates domain-specific best practices into **hierarchical state machines** to control LLM execution. It's designed to improve performance on complex tasks like code generation and question answering, moving beyond simple prompting strategies.
- **EvoFSM: Controllable Self-Evolution for Deep Research**: This framework uses an explicit **Finite State Machine (FSM)** to allow LLM agents to evolve and improve their own problem-solving strategies. This addresses challenges of instability and "instruction drift" in self-modifying agents by keeping changes within the FSM's structured boundaries.
- **Graph of States (GoS): A Neuro-Symbolic Framework for Abductive Tasks**: GoS combines multi-agent collaboration with a **state machine to govern valid transitions** in reasoning. This structured approach helps prevent issues like "evidence fabrication" and "context drift" in complex abductive reasoning tasks.
- **MAPLE: A Mobile Agent with Persistent Finite State Machines**: Designed for mobile GUI automation, MAPLE models app interactions as an FSM. This allows the agent to track navigation progress, verify action outcomes using pre/post-conditions, and recover from errors by rolling back to stable states.

### 🔧 Foundational Tools & Technical Context
For a deeper understanding of the underlying mechanisms, you might find this related work helpful.

- **SGLang: Efficient Execution of Structured Language Model Programs**: While not a framework paper per se, SGLang is a system that provides technical means to enforce structured outputs. It uses techniques like **compressed finite state machines** to dramatically speed up the decoding of structured outputs (e.g., JSON).

| Paper Title | Key Idea | Primary Focus |
| :--- | :--- | :--- |
| **Structure- and Event-Driven Frameworks...** | Frameworks for generating UML state machines from text. | **UML State Machine Generation** |
| **SHERPA** | Hierarchical state machines to encode best practices. | Complex Task Reasoning |
| **EvoFSM** | FSM-guided self-evolution for agents. | Agent Self-Improvement |
| **Graph of States** | State machine to govern abductive reasoning steps. | Logical/Abductive Reasoning |
| **MAPLE** | Persistent FSM for mobile app task execution. | GUI Automation |
| **SGLang** | Runtime system for efficient structured decoding. | **Systems/Inference** |

### 💡 Recommendations for Your Next Step
- **If your primary interest is in formal modeling** (turning requirements into diagrams), start with **Abdulkarim et al.** (arXiv:2604.00275). It is the most direct match to your query.
- **If you are more interested in building robust agents or reasoning systems**, **SHERPA** and **EvoFSM** provide excellent blueprints for using state machines to control LLM behavior.
- **For a deeper dive into technical implementation**, the **SGLang** paper is a key resource for understanding how structured generation can be made efficient at scale.

I hope this gives you a great starting point for your research. Are you more interested in the theoretical modeling of state machines (like the first paper) or their practical application for building more reliable agents (like SHERPA or EvoFSM)?