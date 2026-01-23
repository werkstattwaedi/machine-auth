# DeviceOS Update Docs Task

Update the knowledge base summaries from the local Particle documentation.

## Documentation Sources

Located in `third_party/particle/third_party/docs/src/content/`:

| Source | Target Knowledge File |
|--------|----------------------|
| `reference/device-os/firmware.md` | `WIRING_TO_HAL.md` |
| `reference/datasheets/wi-fi/photon-2-datasheet.md` | `PHOTON2_SUMMARY.md` |

## Update Process

1. **Check for documentation updates**
   ```bash
   git -C third_party/particle/third_party/docs log --oneline -5
   ```

2. **Review Wiring API Reference** (`firmware.md`)
   - Look for new APIs or changes
   - Update `WIRING_TO_HAL.md` with new mappings
   - Check for deprecated functions

3. **Review Photon 2 Datasheet**
   - Check for pin mapping changes
   - Update `PHOTON2_SUMMARY.md` if needed
   - Note any errata or corrections

4. **Cross-reference with HAL**
   - Verify HAL function availability in `device-os/hal/inc/`
   - Check dynalib exports in `hal_dynalib_*.h`
   - Update knowledge files as needed

## Output Format

```markdown
## Documentation Update Summary

### Changes Found
- [List of significant changes]

### Files Updated
- `WIRING_TO_HAL.md` - [what changed]
- `PHOTON2_SUMMARY.md` - [what changed]

### No Changes
- [Files that didn't need updates]
```

## When to Run

- After updating the `docs` submodule
- When investigating a new Wiring API
- When debugging unexpected HAL behavior
