import { describe, expect, test } from 'vitest';

import { computeProgress, formatProgress, taskStats } from '../src/app/progress.js';
import { normalizeProject } from '../src/app/project-model.js';

const withTasks = (progress, flags, status = 'Active') => normalizeProject({
  name: 'T',
  progress,
  status,
  contentItems: flags.map((completed, index) => ({
    type: 'task', text: `t${index}`, completed
  }))
});

describe('locked progress invariants', () => {
  test('42 base + 3 of 4 tasks is 42.75', () => {
    expect(computeProgress(withTasks(42, [true, true, true, false]))).toBe(42.75);
  });

  test('99 base + all tasks complete is 99.99, never 100', () => {
    expect(computeProgress(withTasks(99, [true, true, true]))).toBe(99.99);
  });

  test('explicit Complete status is exactly 100', () => {
    expect(computeProgress(withTasks(99, [true], 'Complete'))).toBe(100);
    expect(computeProgress(withTasks(0, [false, false], 'Complete'))).toBe(100);
  });

  test('manual progress is the integer portion and tasks are the decimal', () => {
    expect(computeProgress(withTasks(42, [true, false]))).toBe(42.5);
    expect(computeProgress(withTasks(0, [true, false, false, false]))).toBe(0.25);
    expect(computeProgress(withTasks(7, [false, false]))).toBe(7);
  });

  test('a project with no tasks is exactly its base integer', () => {
    expect(computeProgress(normalizeProject({ name: 'T', progress: 42, status: 'Active' })))
      .toBe(42);
  });
});

describe('bullets, links, and images never affect progress', () => {
  test('non-task content is excluded from the task count', () => {
    const project = normalizeProject({
      name: 'T',
      progress: 50,
      status: 'Active',
      contentItems: [
        { type: 'task', text: 'a', completed: true },
        { type: 'bullet', text: 'b' },
        { type: 'link', label: 'L', url: 'https://a.example' },
        { type: 'image', src: 'data:image/png;base64,AA', caption: 'c' }
      ]
    });

    expect(taskStats(project)).toEqual({ total: 1, completed: 1 });
    expect(computeProgress(project)).toBe(50.99);
  });

  test('a project made only of bullets, links, and images keeps its base', () => {
    const project = normalizeProject({
      name: 'T',
      progress: 33,
      status: 'Active',
      contentItems: [
        { type: 'bullet', text: 'b' },
        { type: 'link', label: 'L', url: 'https://a.example' },
        { type: 'image', src: 'data:image/png;base64,AA' }
      ]
    });
    expect(computeProgress(project)).toBe(33);
  });
});

describe('rounding and clamping (v3 parity)', () => {
  test('a full task list rounds to 100 hundredths but clamps to 99', () => {
    expect(computeProgress(withTasks(10, [true, true]))).toBe(10.99);
  });

  test('one of three rounds to the nearest hundredth', () => {
    // Math.round(33.333) === 33
    expect(computeProgress(withTasks(0, [true, false, false]))).toBe(0.33);
    // Math.round(66.666) === 67
    expect(computeProgress(withTasks(0, [true, true, false]))).toBe(0.67);
  });

  test('base progress is clamped into 0..99 before use', () => {
    expect(computeProgress(normalizeProject({ name: 'T', progress: 500, status: 'Active' })))
      .toBe(99);
    expect(computeProgress(normalizeProject({ name: 'T', progress: -20, status: 'Active' })))
      .toBe(0);
  });

  test('non-numeric base progress is treated as zero', () => {
    expect(computeProgress({ status: 'Active', progress: 'abc', contentItems: [] })).toBe(0);
  });
});

describe('taskStats (v3 parity)', () => {
  test('missing or non-array contentItems yields zero tasks', () => {
    expect(taskStats({})).toEqual({ total: 0, completed: 0 });
    expect(taskStats({ contentItems: null })).toEqual({ total: 0, completed: 0 });
  });
});

describe('formatProgress (v3 parity)', () => {
  test('a task-free project shows a bare integer', () => {
    expect(formatProgress(normalizeProject({ name: 'T', progress: 42, status: 'Active' })))
      .toBe('42%');
  });

  test('a project with tasks always shows two decimals, even at .00', () => {
    expect(formatProgress(withTasks(42, [false, false]))).toBe('42.00%');
    expect(formatProgress(withTasks(42, [true, true, true, false]))).toBe('42.75%');
    expect(formatProgress(withTasks(99, [true]))).toBe('99.99%');
  });

  test('Complete shows exactly 100%', () => {
    expect(formatProgress(withTasks(42, [false], 'Complete'))).toBe('100%');
  });
});
