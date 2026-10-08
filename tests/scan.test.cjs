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

// Regression: a valid JSON fault document must parse raw and have its string values
// redacted afterwards; redacting the raw text first used to corrupt the JSON.
const labeledBefore = scans.parse(JSON.stringify({ faults: [
  { module: '01 Engine', code: '000123', description: 'Synthetic fault logged for VIN: WVWZZZ1KZ6W000001' },
  { module: '01 Engine', code: 'P0101', description: 'Synthetic alpha tagged License Plate: SYNTH-000' },
  { module: '03 ABS', code: '01234', description: 'Synthetic brake fault' },
]}));
assert.equal(labeledBefore.length, 3);
const labeledText = JSON.stringify(labeledBefore);
assert.ok(!labeledText.includes('WVWZZZ1KZ6W000001'), 'VIN removed from JSON string values');
assert.ok(!labeledText.includes('SYNTH-000'), 'plate removed from JSON string values');
assert.ok(labeledText.includes('VIN: [REDACTED]'), 'VIN label redacted inside a JSON string value');
assert.ok(labeledText.includes('License Plate: [REDACTED]'), 'plate label redacted inside a JSON string value');
const labeledAfter = scans.parse(JSON.stringify([
  { module: '01 Engine', code: '000123', description: 'Synthetic fault logged for VIN: WVWZZZ1KZ6W000001' },
  { module: '01 Engine', code: 'P0300', description: 'Synthetic new code' },
]));
const labeledDiff = scans.diff(labeledBefore, labeledAfter);
assert.equal(labeledDiff.new.length, 1);
assert.equal(labeledDiff.absent.length, 2);
assert.equal(labeledDiff.persisting.length, 1);
assert.equal(labeledDiff.new[0].code, 'P0300');

// Valid JSON that is not a fault document must fail cleanly, not as a JSON syntax error.
assert.throws(() => scans.parse('{"notes": "VIN: ABC"}'), /array of faults/);

// redactDocument keeps structure, keys, and numbers while redacting string values.
const redactedDoc = JSON.parse(scans.redactDocument('{"notes":"VIN: ABC","count":42,"ok":true,"items":[1,2,{"tag":"Serial Number: 99"}]}'));
assert.equal(redactedDoc.notes, 'VIN: [REDACTED]');
assert.equal(redactedDoc.count, 42);
assert.equal(redactedDoc.ok, true);
assert.equal(redactedDoc.items[0], 1);
assert.equal(redactedDoc.items[2].tag, 'Serial Number: [REDACTED]');

// Raw text that only looks like JSON after redaction stays on the text path.
const bareVinText = scans.parse(`WVWZZZ1KZ6W000001
Address 01: Engine
P0101 - Sensor`);
assert.equal(bareVinText.length, 1);
assert.equal(bareVinText[0].code, 'P0101');
console.log('Passed: scan comparison, redaction, and deduplication.');
