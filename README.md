# PF2e Effects Stacking

A Foundry VTT module for Pathfinder 2e that lets same-type modifiers stack when they
come from different sources and have different effect names. For effects with the same
name, only the highest bonus or lowest penalty applies.

It also consolidates duplicate PF2e aura effects into a single generated effect with
source tracking, so overlapping auras like Protective Wards and Dirge of Doom can apply
their combined value cleanly.

## Development

```bash
npm run check
npm run test
npm run setup
npm run watch
```

Foundry loads `dist/pf2e-effects-stacking.js` and `lang/en.json` from `module.json`.
