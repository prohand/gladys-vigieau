import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISPLAY_TIME_ZONE, formatDate, formatDateTime } from '../src/datetime.js';

test('a moment is rendered as JJ/MM/AAAA HH:MM', () => {
  assert.equal(formatDateTime(new Date('2026-06-15T12:34:56Z')), '15/06/2026 14:34');
});

test('the timestamp is rendered in Paris, whatever the container timezone is', () => {
  // The container runs in UTC by default: a refresh at 09:26 in France would
  // otherwise read "07:26" on the dashboard, two hours in the past.
  assert.equal(DISPLAY_TIME_ZONE, 'Europe/Paris');
  // Summer time: +2. Winter time: +1. Both, so a DST bug cannot hide.
  assert.equal(formatDateTime(new Date('2026-07-01T07:26:00Z')), '01/07/2026 09:26');
  assert.equal(formatDateTime(new Date('2026-01-01T07:26:00Z')), '01/01/2026 08:26');
});

test('midnight is 00:00, never 24:00', () => {
  // `hour12: false` renders it as "24:00" in some ICU versions; h23 does not.
  assert.equal(formatDateTime(new Date('2026-06-14T22:00:00Z')), '15/06/2026 00:00');
});

test('the day and the month are zero-padded', () => {
  assert.equal(formatDateTime(new Date('2026-03-05T09:07:00Z')), '05/03/2026 10:07');
});

test('formatDateTime defaults to now', () => {
  assert.match(formatDateTime(), /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
});

test('a VigiEau date is re-ordered, never parsed through a timezone', () => {
  // `new Date('2026-06-15')` is midnight UTC — the 14th at 21:00 in Papeete.
  // A decree must not look a day older than the one the user is reading.
  assert.equal(formatDate('2026-06-15'), '15/06/2026');
  assert.equal(formatDate('2026-01-01'), '01/01/2026');
});

test('a full ISO timestamp keeps only its day', () => {
  assert.equal(formatDate('2026-06-15T00:00:00.000Z'), '15/06/2026');
});

test('a Date object is accepted too', () => {
  assert.equal(formatDate(new Date('2026-06-15T12:00:00Z')), '15/06/2026');
});

test('an absent or unreadable date is null, so the caller can word it', () => {
  for (const value of [null, undefined, '', 'jamais', {}]) {
    assert.equal(formatDate(value), null, `${JSON.stringify(value)} has no date to show`);
  }
});
