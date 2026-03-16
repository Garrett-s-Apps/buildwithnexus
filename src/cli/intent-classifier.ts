export type Intent = 'plan' | 'build' | 'brainstorm';

const PLAN_KEYWORDS = [
  'design', 'plan', 'architect', 'structure', 'outline', 'roadmap',
  'strategy', 'organize', 'breakdown', 'scope', 'model', 'schema',
];

const BUILD_KEYWORDS = [
  'build', 'create', 'make', 'write', 'implement', 'code', 'generate',
  'add', 'fix', 'update', 'deploy', 'run', 'start', 'launch', 'install',
  'set up', 'setup', 'refactor', 'migrate',
];

const BRAINSTORM_KEYWORDS = [
  'what', 'should', 'idea', 'ideas', 'think', 'consider', 'suggest',
  'brainstorm', 'explore', 'wonder', 'might', 'could', 'would', 'how about',
  'what if', 'options', 'alternatives', 'thoughts',
];

export function classifyIntent(task: string): Intent {
  const lower = task.toLowerCase().trim();

  let planScore = 0;
  let buildScore = 0;
  let brainstormScore = 0;

  for (const kw of PLAN_KEYWORDS) {
    if (lower.includes(kw)) planScore++;
  }
  for (const kw of BUILD_KEYWORDS) {
    if (lower.includes(kw)) buildScore++;
  }
  for (const kw of BRAINSTORM_KEYWORDS) {
    if (lower.includes(kw)) brainstormScore++;
  }

  // Tiebreak: longer/more complex tasks default to plan
  const wordCount = lower.split(/\s+/).length;
  if (wordCount > 12 && planScore === buildScore && buildScore === brainstormScore) {
    return 'plan';
  }

  if (brainstormScore > planScore && brainstormScore > buildScore) return 'brainstorm';
  if (buildScore > planScore && buildScore > brainstormScore) return 'build';
  if (planScore > 0) return 'plan';

  // Default: complex tasks → plan, simple short tasks → build
  return wordCount > 6 ? 'plan' : 'build';
}
