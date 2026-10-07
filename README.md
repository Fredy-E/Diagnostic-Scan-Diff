<p align="center">
  <img src="assets/banner.png" alt="Diagnostic Scan Diff - compare diagnostic scan logs locally" width="100%">
</p>

<p align="center">
  <a href="https://github.com/Fredy-E/Diagnostic-Scan-Diff/actions/workflows/verify.yml"><img src="https://github.com/Fredy-E/Diagnostic-Scan-Diff/actions/workflows/verify.yml/badge.svg" alt="verify"></a>
  <img src="https://img.shields.io/badge/platform-browser-29354b?style=flat-square" alt="Platform: browser">
  <img src="https://img.shields.io/badge/local-no%20uploads-c7a366?style=flat-square" alt="No uploads">
  <img src="https://img.shields.io/badge/status-prototype-737373?style=flat-square" alt="Status: prototype">
  <img src="https://img.shields.io/badge/license-MIT-737373?style=flat-square" alt="License: MIT">
</p>

## What this is

Open `index.html`. Load or paste before/after text logs or JSON fault lists, then compare. The first version groups faults by module and code, collapses duplicates, and exports a JSON comparison.

- Supports common VCDS-style `Address` headers, numeric fault lines, and five-character P/B/C/U codes; unknown log layouts may parse incompletely.
- Redaction of likely VINs and common identifying labels is best effort — review exports before sharing them.
- “Absent from a later scan” describes the log comparison only. It does not certify a repair or interpret vehicle safety.

JSON example:

```json
[{"module":"01 Engine","code":"P0101","description":"Example"}]
```

## Checks

```sh
node tests/scan.test.cjs
```

CI runs the same checks on every push (badge above).

## Next

Real format fixtures, scan completeness metadata, and richer duplicate/status handling.

## See also

[DriverLens](https://github.com/Fredy-E/DriverLens) · [ARM64 Compatibility Radar](https://github.com/Fredy-E/ARM64-Compatibility-Radar) · [MeshLab Mini](https://github.com/Fredy-E/MeshLab-Mini) · [Offline Museum Kit](https://github.com/Fredy-E/Offline-Museum-Kit) — small local-first tools built for Windows-on-ARM work.
