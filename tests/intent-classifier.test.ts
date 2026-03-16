import { describe, it, expect } from 'vitest';
import { classifyIntent } from '../src/cli/intent-classifier.js';

describe('classifyIntent', () => {
  it('classifies PLAN keywords: "design"', () => {
    expect(classifyIntent('design the system architecture')).toBe('plan');
  });

  it('classifies PLAN keywords: "plan", "architecture", "strategy"', () => {
    expect(classifyIntent('plan the architecture and strategy')).toBe('plan');
  });

  it('classifies BUILD keywords: "build", "create", "implement"', () => {
    expect(classifyIntent('build and implement the feature')).toBe('build');
  });

  it('classifies BRAINSTORM keywords: "what", "should", "ideas"', () => {
    expect(classifyIntent('what ideas should we consider')).toBe('brainstorm');
  });

  it('falls back to build for short tasks with no matching keywords', () => {
    expect(classifyIntent('do it')).toBe('build');
  });

  it('falls back to plan for longer tasks with no matching keywords', () => {
    // >6 words, no category keywords → plan
    expect(classifyIntent('the quick brown fox jumps over the lazy dog')).toBe('plan');
  });

  it('keyword weighting: brainstorm beats build when score is higher', () => {
    // "what", "should", "ideas", "think" vs no build keywords
    expect(classifyIntent('what should we think about ideas and options')).toBe('brainstorm');
  });
});
