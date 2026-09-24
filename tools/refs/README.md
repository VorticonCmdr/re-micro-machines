# Live reference captures

Raw captures from the real game under the DOSBox bridge, used by `tools/check-live.mjs` to pixel-diff
the decoders against what the game actually drew. Not game data files; small enough to keep.

| File | What | How captured |
|---|---|---|
| `race_R21_a000.bin` | 64000 B mode-13h frame buffer (`A000:0000`), POWERBOATS round 2 race 1, one-player Challenge, a few seconds into the race | `mem_read` A000:0000 via `mcp__dosbox__*` during the research workflow's live boot trace |
| `race_R21_dac.bin` | 768 B DAC read back through port 3C9h at the same moment | `port_read` 3C7←0 then 768 × 3C9 |

The race view occupies screen x = 32..287 (256×200); columns 0..31 hold the HUD, 288..319 are black.
Best-fit camera for the frame: world (414, 500) px, found by exhaustive search — see `check-live.mjs`.

Why these are kept although `game/` is never committed: they are 64 KB of *rendered output* and a
768-byte DAC state, not distributable game files — nothing can be extracted from them beyond one
screenful of an already-decoded scene. They exist so the exactness claim is reproducible.
