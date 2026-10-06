import { relativeDate } from './relative-date.pipe';

describe('relativeDate', () => {
  const now = Date.parse('2026-10-06T17:00:00Z');

  it.each([
    ['2026-10-06T16:59:40Z', 'now'],
    ['2026-10-06T16:40:00Z', '20m ago'],
    ['2026-10-06T15:00:00Z', '2h ago'],
    ['2026-10-03T17:00:00Z', '3d ago'],
  ])('formats %s as %s', (value, expected) => expect(relativeDate(value, now)).toBe(expected));

  it('uses an em dash for missing or invalid values', () => {
    expect(relativeDate(null, now)).toBe('—');
    expect(relativeDate('invalid', now)).toBe('—');
  });
});
