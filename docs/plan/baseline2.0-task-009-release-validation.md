# TASK-009 Release Validation Evidence

Date: 2026-08-07
Status: completed, uncommitted

## Release Contract

- Version: `2.0.0-beta.1`
- Application identity: `com.flux.text-editor` / `Flux`
- Platform: Windows x64 only
- Targets: NSIS installer and electron-builder portable executable
- Associations: `.md`, `.markdown`, `.txt`, `.log` (installer configuration only)
- Portable data root: `<PORTABLE_EXECUTABLE_DIR>/data`
- Signing: disabled; both generated executables report `NotSigned`.

## Verification

- `npm test`: 31 files, 175 tests passed.
- `npm run build`: main, preload, and renderer production bundles passed.
- `npm run lint`: passed with 19 pre-existing unused-variable or unused-disable warnings and no errors.
- `git diff --check`: passed.
- `npm run pack:win`: passed.

## Produced Artifacts

- `release/Flux-2.0.0-beta.1-setup-x64.exe` (122,502,727 bytes)
- `release/Flux-2.0.0-beta.1-portable-x64.exe` (122,177,824 bytes)

The two artifact names are distinct and both files were created by electron-builder.
