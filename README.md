# PF2e Effects Stacking

A Foundry VTT module for Pathfinder 2e that changes how same-type modifiers stack.

PF2e normally keeps only one modifier for a given type and kind. For example, two
`+1 status` bonuses to AC from different effects do not stack. This module allows
same-type modifiers to stack when they come from different sources.

If two modifiers share the same source, only the strongest one for that type and kind
is used.

## Development

```bash
npm run check
npm run test
npm run build
```

The module patches `game.pf2e.StatisticModifier.prototype.calculateTotal` on Foundry's
`ready` hook.
