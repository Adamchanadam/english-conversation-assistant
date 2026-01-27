---
name: prompt-consolidation
description: A governance pattern for managing AI prompts/instructions that prevents drift, duplication, and hardcoded assumptions. Use when prompt complexity grows beyond maintainability.
---

# Prompt Consolidation Pattern

## Problem Statement

When iteratively developing AI prompts/instructions:
- Patches accumulate on patches
- Each patch introduces new hardcoded assumptions
- Instructions become complex, contradictory, or drift from intent
- Debugging becomes difficult (no single source of truth)

## Solution: Prompt Consolidation

A governance pattern that consolidates prompts to a stable, minimal state.

## Core Principles

### 1. Single Source of Truth (SSOT)
All dynamic values come from ONE source (config/props/state).

```javascript
// BAD: Values scattered, hardcoded
const instructions = `You are [hardcoded name] doing [hardcoded task]...`;

// GOOD: Single source, pure reference
const I = config.identity;
const O = config.otherParty;
const instructions = `You are ${I}. You are speaking with ${O}.`;
```

### 2. Definition-Reference Pattern
Define once at top, reference throughout.

```javascript
// DEFINITIONS (single entry point):
//   I = config.agentName
//   O = config.counterpartType
//   G = config.goal
//   L = config.language
//
// INSTRUCTIONS: Only reference I, O, G, L
```

### 3. Immutable Core Rules
Small set of fundamental constraints that never change.

```
CORE RULES (immutable):
  1. IDENTITY: AI = I, never O
  2. PURPOSE: AI pursues G
  3. LANGUAGE: AI speaks L
  4. INTERACTION: Input = O, Output = I
```

### 4. No Hardcoded Scenarios
Templates use only variables, no assumptions about use cases.

```javascript
// BAD: Hardcoded scenario assumption
`You are the [assumed role] who [assumed relationship]`

// GOOD: Pure reference, no assumptions
`You are ${I}. Your purpose: ${G}`
```

### 5. One-In-One-Out Rule
Each new rule must retire an old one to prevent bloat.

Before adding a new instruction:
1. Can it be merged with existing?
2. Does it replace something?
3. Is it truly necessary?

### 6. Consolidation Testing
Before freeze, verify:
- [ ] No duplicate definitions
- [ ] No contradictory rules
- [ ] No scenario drift (hardcoded assumptions)
- [ ] Minimal viable instruction set

## Template Structure

```
[SECTION_1] Core constraint using ${variables}

[SECTION_2] Another constraint using ${variables}

${conditional ? `[OPTIONAL] ${conditional}` : ''}

[STYLE] Behavioral guidance (no scenario assumptions)
```

## Application Checklist

When refactoring existing prompts:

1. **Extract**: List all dynamic values → create DEFINITIONS
2. **Distill**: Identify immutable rules → create CORE RULES (aim for 3-5)
3. **Reference**: Rewrite instructions using only definition references
4. **Scan**: Check for duplicates, contradictions, hardcoded scenarios
5. **Test**: Verify with edge cases (different scenarios)
6. **Freeze**: Lock the structure, only config values change

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|--------------|---------|-----|
| Patch-on-Patch | Complexity grows | Refactor to SSOT |
| Scenario Lock | Assumes specific use case | Use pure variables |
| Rule Sprawl | Too many rules | One-In-One-Out |
| Mixed Languages | Confuses model | Single language in template |
| Implicit Context | Model guesses meaning | Explicit relationships |

## Example: Before/After

**Before (sprawling, hardcoded)**:
```
## YOUR IDENTITY (CRITICAL - NEVER BREAK)
You are [hardcoded name]. You are [hardcoded scenario].
## YOUR PURPOSE (CRITICAL - THIS IS WHAT YOU MUST DO)
You initiated this conversation to [hardcoded task].
[Hardcoded relationship assumption]
## ROLE BOUNDARY (ABSOLUTE)
[More hardcoded assumptions about the interaction]
... (multiple overlapping sections, scenario assumptions)
```

**After (consolidated, pure reference)**:
```
// DEFINITIONS (single source - from config/props/state)
I = config.agentName        // who AI represents (the caller)
O = config.counterpartType  // who AI speaks with (the callee)
G = config.goal             // what to achieve
L = config.taskLanguage     // what language to use
R = config.rules            // constraints
S = config.ssot             // reference data

// CORE RULES (immutable, no scenario assumptions)
1. CRITICAL IDENTITY: AI = I, NEVER act as O
2. CALLER ROLE: AI is the CALLER, not the service provider
3. PURPOSE: AI pursues G
4. LANGUAGE: AI speaks L
5. INTERACTION: Voice heard = O, respond as I

// INSTRUCTIONS (only references, no hardcoded values)
[LANGUAGE] Speak only in ${L}.

[CRITICAL IDENTITY]
- You ARE ${I}.
- You are CALLING ${O} to achieve your goal.
- You are the CALLER, not the service provider.
- NEVER act as ${O}. NEVER give advice like a customer service rep.

[INTERACTION] The voice you hear is ${O} (the one you called). You respond as ${I} (the caller).

[YOUR GOAL] ${G}

[WHAT YOU KNOW] Only say what ${I} would know.
```

## When to Apply

Use Prompt Consolidation when:
- Prompt has been patched 3+ times
- Bugs recur in different forms
- Adding rules doesn't fix behavior
- Debugging requires reading entire prompt

## Limitations

- Requires upfront design thinking
- May be too minimal for complex personas
- Core rules need domain understanding to define correctly

## Related Patterns

- Single Responsibility Principle (each rule does one thing)
- DRY (Don't Repeat Yourself)
- Configuration over Convention
