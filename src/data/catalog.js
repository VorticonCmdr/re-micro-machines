// The asset inventory: which files exist, what each one is, and how far its format is known.
//
// Hand-maintained rather than a directory listing because (a) HTTP can't enumerate a
// directory, and (b) the real inventory is irregular in ways worth recording explicitly:
// rounds 5, 7 and 8 have no .PR2, round 9 has no .BRK files, rounds 1–2 have four races and
// the rest three. The list is exactly INSTALL.DAT's COPYFILE manifest plus the two files added
// after installation (MICROU.EXE, UNP.EXE). See CLAUDE.md for the evidence behind each note.
//
// `status` is the decoder state, not a guess about the format:
//   'decoded'  — a decoder exists and its output has been rendered and looked at
//   'partial'  — structure known in part (or unverified); the viewer shows what it can
//   'unknown'  — no decoder; the probe view (hex / stats / raw image) is all there is
//   'n/a'      — not an asset (installer, launcher, runtime state)

export const FAMILY = {
  EXE: 'exe',
  MODULE: 'module',
  PALETTE: 'palette',
  ARCHIVE: 'archive',
  MAP: 'map',
  TILETABLE: 'tiletable',
  TRACK_GFX: 'track-gfx',
  TRACK_LAYOUT: 'track-layout',
  TRACK_MISC: 'track-misc',
  GLOBAL: 'global',
  CONFIG: 'config',
  INSTALLER: 'installer',
}

export const FAMILY_LABEL = {
  [FAMILY.PALETTE]: 'Palettes',
  [FAMILY.ARCHIVE]: 'COMPRESS archives',
  [FAMILY.TRACK_GFX]: 'Track graphics (PR0/PR1/PR2/VH0)',
  [FAMILY.TRACK_LAYOUT]: 'Track layout (MAP/COL/DIR/CT)',
  [FAMILY.TRACK_MISC]: 'Per-track data (BRK/LEV)',
  [FAMILY.GLOBAL]: 'Global data',
  [FAMILY.MODULE]: 'Code modules (.BIN)',
  [FAMILY.CONFIG]: 'Config & runtime state',
  [FAMILY.EXE]: 'Executables & launcher',
  [FAMILY.INSTALLER]: 'Installer (not game data)',
}

/** Display order for the sidebar: asset families first, non-assets last. */
export const FAMILY_ORDER = [
  FAMILY.PALETTE, FAMILY.ARCHIVE, FAMILY.TRACK_GFX, FAMILY.TRACK_LAYOUT, FAMILY.TRACK_MISC,
  FAMILY.GLOBAL, FAMILY.MODULE, FAMILY.CONFIG, FAMILY.EXE, FAMILY.INSTALLER,
]

/** Which view renders an entry. Anything without a dedicated decoder gets the probe. */
export const KIND = {
  PALETTE: 'palette',
  GFX1: 'gfx1',
  FONTBIN: 'fontbin',
  ARCHIVE: 'archive',
  MAP: 'map',
  TILETABLE: 'tiletable',
  TILEBANK: 'tilebank',
  VEHICLE: 'vehicle',
  BITSFILE: 'bitsfile',
  SOUND: 'sound',
  LEVBRK: 'levbrk',
  GLOBALDATA: 'globaldata',
  SETTINGS: 'settings',
  PROBE: 'probe',
}

/** Races per round, from the shipped ROUNDnm.MAP files (and INSTALL.DAT's manifest). */
export const RACES_PER_ROUND = { 1: 4, 2: 4, 3: 3, 4: 3, 5: 3, 6: 3, 7: 3, 8: 3, 9: 3 }
const ROUNDS_WITHOUT_PR2 = new Set([5, 7, 8])
const ROUNDS_WITHOUT_BRK = new Set([9])

const entry = (path, family, kind, status, note = '') => ({ path, name: path.split('/').pop(), family, kind, status, note })

function buildCatalog() {
  const c = []

  // --- top level -------------------------------------------------------------------------
  c.push(entry('INTRO.PAL', FAMILY.PALETTE, KIND.PALETTE, 'decoded', '768 B = 256 × RGB 6-bit DAC, uploaded verbatim (INT 10h AX=1012h); byte-identical to GAME1/INTRO.PAL. Menu palette.'))
  for (let i = 0; i <= 6; i++) c.push(entry(`COMPRESS.PI${i}`, FAMILY.ARCHIVE, KIND.ARCHIVE, 'decoded', `Slab ${i} of the 328 KB front-end asset arena (LZ-packed, 48 KB stride); the 18 .CHR members are described by MICROU.EXE's descriptor table.`))
  c.push(entry('BITSFILE.PH0', FAMILY.GLOBAL, KIND.BITSFILE, 'decoded', 'LZ-packed shared race graphics (26048 B unpacked → DS:3FE3). Fully mapped from +0x1380 to EOF (checkpoint-direction icon pair, 11-glyph 8×16 digit table, HUD light pair, position labels, a dual-purpose +0x1F00 slot — PH0’s own bytes are a round-2 boat-splash, overwritten by ROUND8BR.VH0’s chopper-rotor bytes during round 8 — 5 tail icons, 6 banners) with zero gaps; +0x0000–0x0600 is the wheel/wake puffs. +0x0600–0x1140 holds the five state-2/0xD knockout frames and +0x1140–0x1380 a sixth slot the frame table never selects (docs/engine.md §4, §9cf). Opened as ..\\BITSFILE.PH0 (the game runs with GAME1/ as CWD).'))
  c.push(entry('GFX1.GFX', FAMILY.GLOBAL, KIND.GFX1, 'decoded', 'Uncompressed 8-bpp sprite pack for the Codemasters logo intro drawn by SM.EXE; palette and draw list live in SM.EXE.'))
  c.push(entry('FONT.BIN', FAMILY.MODULE, KIND.FONTBIN, 'partial', 'Not a font: the code-card copy-protection module (x86 code, mode 10h). Embedded planar graphics and the card table are decoded; the compare sites are patched out in this copy.'))
  c.push(entry('ANTIFONT.BIN', FAMILY.MODULE, KIND.PROBE, 'n/a', '0 bytes, in the original archive too. SM.EXE expects a 91-glyph 11×13 8-bpp proportional font here (13013 B) for its copyright line; with the empty file nothing visible is drawn.'))
  c.push(entry('DRIVER0.BIN', FAMILY.MODULE, KIND.SOUND, 'decoded', '8 B: two `mov ax,0; retf` stubs — the null sound driver (SOUND = NONE).'))
  c.push(entry('DRIVER1.BIN', FAMILY.MODULE, KIND.SOUND, 'decoded', 'Sound Images Generation 2 OPL2/AdLib driver (SOUND = BLASTER): x86 code + ALL the music (8 tunes), 18 sfx and 128 instruments embedded. Sequencer ported; register stream matches the live driver write-for-write.'))
  c.push(entry('DRIVER2.BIN', FAMILY.MODULE, KIND.SOUND, 'partial', 'Sound Images Generation 2 "Internal Beeper v1.08" (SOUND = SPEAKER): same command set and container, PC-speaker arrangements of the same 8 tunes (2–3 channels, round-robin). Listing only; no beeper playback yet.'))
  c.push(entry('SETTINGS.DAT', FAMILY.CONFIG, KIND.SETTINGS, 'decoded', '32 B written by the options screen: 8 words (controls, smoothness, sound driver, joystick thresholds) + 16 PC scancodes (key bindings). Runtime state, not distribution content.'))
  c.push(entry('MICRO.COM', FAMILY.EXE, KIND.PROBE, 'n/a', 'Launcher: EXECs SM.EXE then MICRO.EXE.'))
  c.push(entry('SM.EXE', FAMILY.EXE, KIND.PROBE, 'n/a', 'Codemasters "Absolutely Brilliant!" logo intro (mode 13h). Holds the GFX1.GFX palette (0x56C) and draw list (0x21E). Not the copy protection.'))
  c.push(entry('MICRO.EXE', FAMILY.EXE, KIND.PROBE, 'n/a', 'The game, PKLITE-packed. Do not disassemble this one.'))
  c.push(entry('MICROU.EXE', FAMILY.EXE, KIND.PROBE, 'n/a', 'Unpacked MICRO.EXE (user-added) — the Ghidra target. Runs in VGA mode 13h.'))
  c.push(entry('UNP.EXE', FAMILY.EXE, KIND.PROBE, 'n/a', 'UNP executable expander (user-added).'))
  for (const p of ['INSTALL.EXE', 'INSTALL.DAT', 'SETUP.EXE', 'CTL3D.DLL', 'APPSETUP.INF', 'MICRO.PIF', 'MICRO.ICO', 'CHKLIST.MS']) {
    c.push(entry(p, FAMILY.INSTALLER, KIND.PROBE, 'n/a', ''))
  }

  // --- GAME1/ — the one shipped game set --------------------------------------------------
  c.push(entry('GAME1/INTRO.PAL', FAMILY.PALETTE, KIND.PALETTE, 'decoded', 'Byte-identical to the top-level INTRO.PAL (the game only opens the top-level one).'))
  c.push(entry('GAME1/STRT_POS.BIN', FAMILY.GLOBAL, KIND.GLOBALDATA, 'decoded', '144 B: 9 rounds × 4 race-slots × {x,y} world start coordinates (InitRaceCarsFromTables 1000:3d9f-3e0e).'))
  c.push(entry('GAME1/CHEATS.BIN', FAMILY.GLOBAL, KIND.GLOBALDATA, 'decoded', '360 B: 30 × 12-byte {round,race,x,y,type,param} records, matched by position in FUN_1000_35F0 (1000:3601-3652); what each numbered type does is undecoded.'))
  c.push(entry('GAME1/CHKLIST.MS', FAMILY.INSTALLER, KIND.PROBE, 'n/a', ''))
  for (let r = 1; r <= 9; r++) {
    c.push(entry(`GAME1/ROUND${r}.PAL`, FAMILY.PALETTE, KIND.PALETTE, 'decoded', `Round ${r} race palette (768 B, 6-bit DAC); the live DAC during a round-2 race matched ROUND2.PAL exactly.`))
    c.push(entry(`GAME1/ROUND${r}.COL`, FAMILY.TRACK_LAYOUT, KIND.TILETABLE, 'decoded', '18 B per tile = 12×12 one-bit collision mask (TestColMaskBitAtWorldXY 1000:589C). Tile count = size/18.'))
    c.push(entry(`GAME1/ROUND${r}.DIR`, FAMILY.TRACK_LAYOUT, KIND.TILETABLE, 'decoded', (r === 8 ? '2300 B: 63 tiles + 32 bytes, NOT 2× COL in this round. ' : '') + '36 B per tile = 6×6 bytes, one per 2×2-cell block (LookupDirByteForCar 1000:585B). Each byte = terrain grade/ramp nibble (class-based immunity, ramp launch) + a direction nibble feeding a verified 16-point-compass heading lookup (AI flow field).'))
    c.push(entry(`GAME1/ROUND${r}BR.CT`, FAMILY.TRACK_LAYOUT, KIND.TILETABLE, 'decoded', '72 B per meta-tile = 6×6 little-endian words = 16×16 tile indices into the PR bank (bit 15 set later for overlay ranges). Copied per MAP cell into the 192×192 word map (1000:448C).'))
    c.push(entry(`GAME1/ROUND${r}BR.LEV`, FAMILY.TRACK_MISC, KIND.LEVBRK, 'decoded', '49–64 B per round, one byte per meta-tile: bit 7 projectile line-of-sight block, bits 6–5 respawn heading, bits 4–2 spawn-nudge vector (1000:5DE0, 1000:70C8).'))
    const prNote = 'LZ slab of the round\'s 16×16 tile bank (256 B/tile, opaque 8-bpp; up to 576 tiles across PR0–PR2).'
    c.push(entry(`GAME1/ROUND${r}BR.PR0`, FAMILY.TRACK_GFX, KIND.TILEBANK, 'decoded', prNote + ' Tile 0 is also copied to DS:3EE3.'))
    c.push(entry(`GAME1/ROUND${r}BR.PR1`, FAMILY.TRACK_GFX, KIND.TILEBANK, 'decoded', prNote))
    if (!ROUNDS_WITHOUT_PR2.has(r)) c.push(entry(`GAME1/ROUND${r}BR.PR2`, FAMILY.TRACK_GFX, KIND.TILEBANK, 'decoded', prNote + ' Absent for rounds 5, 7, 8 (their banks fit in two slabs).'))
    c.push(entry(`GAME1/ROUND${r}BR.VH0`, FAMILY.TRACK_GFX, KIND.VEHICLE, 'decoded', r === 9 ? 'LZ-packed vehicle frames: 9 × 40×40 (Ruff Trux) + a 5-frame second bank at 0x3840.' : 'LZ-packed vehicle frames: 9 × 24×24 (headings 0–90°) expanded to 32 rotations by mirroring, + a 12-frame second bank at 0x1440.'))
    for (let m = 1; m <= RACES_PER_ROUND[r]; m++) {
      c.push(entry(`GAME1/ROUND${r}${m}.MAP`, FAMILY.TRACK_LAYOUT, KIND.MAP, 'decoded', '2048 B: 32×32 meta-tile bytes (bits 0–5 index into CT/COL/DIR, 6–7 attribute) + a 32×32 second plane, a per-tile track-progress value consumed by TestColMaskBitAtWorldXY and used as the .BRK byte offset. Assembles into the full 3072×3072 track via CT and the PR bank.'))
      if (!ROUNDS_WITHOUT_BRK.has(r)) c.push(entry(`GAME1/ROUND${r}${m}B.BRK`, FAMILY.TRACK_MISC, KIND.LEVBRK, 'decoded', '29–183 B, a per-race AI brake/speed-limit-point stream indexed by track-progress (1000:5495); round 9 has none (by design).'))
    }
  }
  return c
}

export const CATALOG = buildCatalog()

/** All palette entries, for the image probe's palette picker. */
export const PALETTES = CATALOG.filter((e) => e.kind === KIND.PALETTE)

export const byPath = (path) => CATALOG.find((e) => e.path.toLowerCase() === path.toLowerCase())
