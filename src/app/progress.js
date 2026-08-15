import { clamp } from './util.js';

/**
 * Locked progress semantics.
 *
 *   manual base progress -> integer portion (0..99)
 *   task completion      -> decimal portion (.00...99)
 *   explicit Complete    -> exactly 100
 *
 *   42 base + 3 of 4 tasks = 42.75
 *   99 base + all complete = 99.99
 *
 * Bullets, links, and images never contribute. A fully complete task list
 * rounds to 100 hundredths and is then clamped to 99, which is what keeps a
 * non-Complete project from ever displaying 100%.
 */

export function taskStats(project) {
  const items = Array.isArray(project?.contentItems) ? project.contentItems : [];
  const tasks = items.filter(item => item.type === 'task');
  return {
    total: tasks.length,
    completed: tasks.filter(item => item.completed).length
  };
}

export function computeProgress(project) {
  if (project.status === 'Complete') return 100;
  const base = clamp(Math.trunc(Number(project.progress) || 0), 0, 99);
  const stats = taskStats(project);
  if (!stats.total) return base;
  const decimalHundredths = clamp(Math.round((stats.completed / stats.total) * 100), 0, 99);
  return Number((base + decimalHundredths / 100).toFixed(2));
}

export function formatProgress(project) {
  const value = computeProgress(project);
  const stats = taskStats(project);
  if (value === 100) return '100%';
  if (!stats.total) return `${Math.trunc(value)}%`;
  return `${value.toFixed(2)}%`;
}
