const assert = require('node:assert/strict');
const scans = require('../scan.js');

const before = scans.parse('VIN: WVWZZZ1KZ6W000001\nAddress 01: Engine\n000123 - Example\nP0101 - Sensor\nP0101 - Duplicate');
const after = scans.parse('Address 01: Engine\n000123 - Example\nP0300 - New');
assert.equal(before.length, 2);
assert.equal(after.length, 2);
const diff = scans.diff(before, after);
assert.equal(diff.new.length, 1);
assert.equal(diff.absent.length, 1);
assert.equal(diff.persisting.length, 1);
assert(!scans.redact('VIN: WVWZZZ1KZ6W000001\nLicense Plate: PRIVATE').includes('PRIVATE'));
assert(!JSON.stringify(before).includes('WVWZZZ'));
console.log('Passed: scan comparison, redaction, and deduplication.');
