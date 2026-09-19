import { describe, expect, it } from 'vitest';
import { reminderStep } from './planner';
import { deadlineTemplateKey, parseReminderSettings, renderTemplate } from './templates';

const OFFSETS = [15, 7, 2, 0];

describe('reminderStep', () => {
  const due = '2026-10-20';
  it('fires at 15, 7, 2 and 0 days', () => {
    expect(reminderStep(due, '2026-10-05', OFFSETS)).toBe(15);
    expect(reminderStep(due, '2026-10-13', OFFSETS)).toBe(7);
    expect(reminderStep(due, '2026-10-18', OFFSETS)).toBe(2);
    expect(reminderStep(due, '2026-10-20', OFFSETS)).toBe(0);
  });
  it('is silent before the first offset and after the deadline', () => {
    expect(reminderStep(due, '2026-10-04', OFFSETS)).toBeNull();
    expect(reminderStep(due, '2026-10-21', OFFSETS)).toBeNull();
  });
  it('catches up after a missed day: the step reached last still applies', () => {
    expect(reminderStep(due, '2026-10-14', OFFSETS)).toBe(7);
    expect(reminderStep(due, '2026-10-19', OFFSETS)).toBe(2);
  });
  it('honours custom offsets', () => {
    expect(reminderStep(due, '2026-10-10', [10, 3])).toBe(10);
    expect(reminderStep(due, '2026-10-20', [10, 3])).toBe(3);
  });
});

describe('templates', () => {
  it('renders variables, tolerating spaces and unknown names', () => {
    expect(
      renderTemplate('Hola {{ cliente }}: {{modelos}}{{nada}}.', {
        cliente: 'Marta',
        modelos: '303',
      }),
    ).toBe('Hola Marta: 303.');
  });
  it('maps any step to the closest default wording', () => {
    expect([20, 10, 7, 5, 2, 1, 0].map(deadlineTemplateKey)).toEqual([
      'reminder.deadline.15d',
      'reminder.deadline.15d',
      'reminder.deadline.7d',
      'reminder.deadline.7d',
      'reminder.deadline.2d',
      'reminder.deadline.2d',
      'reminder.deadline.0d',
    ]);
  });
  it('falls back to defaults for missing or broken settings', () => {
    expect(parseReminderSettings(null)).toEqual({
      enabled: true,
      offsets: [15, 7, 2, 0],
      inactivityDays: 30,
      permanentExpiryOffsets: [60, 30, 7],
    });
    expect(
      parseReminderSettings({ enabled: false, offsets: 'x', inactivityDays: 10 }),
    ).toMatchObject({ enabled: false, offsets: [15, 7, 2, 0], inactivityDays: 10 });
  });
});
