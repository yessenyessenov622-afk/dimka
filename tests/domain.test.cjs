const assert = require('node:assert/strict');
const { escapeHtml, isOwner, isValidTimezone, pageCount, parseLocalDateTime, reminderAt, shouldRouteToReplySession } = require('../dist/domain');

const cases = [
  ['owner access compares Telegram IDs safely', () => {
    assert.equal(isOwner(1234, 1234n), true);
    assert.equal(isOwner(1235, 1234n), false);
    assert.equal(isOwner(undefined, 1234n), false);
  }],
  ['active reply routing ignores commands and interactive flows', () => {
    assert.equal(shouldRouteToReplySession(false, true, false), true);
    assert.equal(shouldRouteToReplySession(true, true, false), false);
    assert.equal(shouldRouteToReplySession(false, true, true), false);
    assert.equal(shouldRouteToReplySession(false, false, false), false);
  }],
  ['task dates use the selected timezone and reject invalid dates', () => {
    assert.equal(parseLocalDateTime('2026-11-02 09:30', 'Asia/Almaty').toISOString(), '2026-11-02T04:30:00.000Z');
    assert.equal(parseLocalDateTime('2026-02-30 09:30', 'Asia/Almaty'), null);
    assert.equal(isValidTimezone('Asia/Almaty'), true);
    assert.equal(isValidTimezone('Mars/Olympus'), false);
  }],
  ['task reminders are scheduled fifteen minutes before the due time', () => {
    const due = new Date('2026-11-02T10:15:00.000Z');
    assert.equal(reminderAt(due).toISOString(), '2026-11-02T10:00:00.000Z');
    assert.equal(reminderAt(null), null);
  }],
  ['pagination and HTML escaping handle empty and unsafe values', () => {
    assert.equal(pageCount(0, 10), 1);
    assert.equal(pageCount(21, 10), 3);
    assert.equal(escapeHtml('<a "x">&'), '&lt;a &quot;x&quot;&gt;&amp;');
  }],
];

for (const [name, run] of cases) {
  run();
  console.log(`✓ ${name}`);
}
console.log(`${cases.length} tests passed.`);
