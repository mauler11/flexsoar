/**
 * scripts/render-sprite.ts
 *
 * Renders sprite maps to PNG files so you can LOOK at them while editing
 * lib/sprites/maps.ts. This is the feedback loop: edit the map, run this,
 * open the PNGs, judge, repeat. Do not author pixel maps blind.
 *
 * Zero dependencies — the PNG encoder is hand-rolled on node:zlib, and the
 * sprite modules are loaded through Node's native TypeScript type-stripping
 * (Node >= 22.18). Run it with plain node:
 *
 *   node scripts/render-sprite.ts                        # all maps x sail_blue
 *   node scripts/render-sprite.ts high-top --palette all # one map, every palette
 *   node scripts/render-sprite.ts --px 16 --out C:\tmp   # bigger, elsewhere
 *
 * For every map x palette pair it writes two files: one at --px (default 12,
 * the "can I see what I'm doing" scale) and one at px=2, the CardTile
 * thumbnail scale — if the shoe stops reading at px=2 the map is overdrawn.
 * Both composite onto the #0B0B0B card background so you judge the sprite
 * against the surface it actually ships on (--bg changes it, --bg none for
 * transparency).
 *
 * The sprite modules are imported with a computed specifier because tsconfig
 * does not enable allowImportingTsExtensions; Node resolves the .ts files
 * fine at runtime (maps.ts/render.ts only use type-only imports internally,
 * which strip away).
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type SpriteMap = readonly string[];
type SpritePalette = Readonly<Record<string, string>>;

const spritesModule = (file: string): string =>
  new URL(`../lib/sprites/${file}`, import.meta.url).href;

const { SPRITE_MAPS, PALETTES } = (await import(spritesModule("maps.ts"))) as {
  SPRITE_MAPS: Record<string, SpriteMap>;
  PALETTES: Record<string, SpritePalette>;
};

// ---------------------------------------------------------------- CLI args

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter(
  (a, i) => !a.startsWith("--") && args[i - 1]?.startsWith("--") !== true,
);

const px = Number(flag("px") ?? 12);
const outDir = flag("out") ?? join(tmpdir(), "flexsoar-sprites");
const bgArg = flag("bg") ?? "#0B0B0B";
const background = bgArg === "none" ? null : bgArg;

const mapNames = positional.length > 0 ? positional : Object.keys(SPRITE_MAPS);
const paletteArg = flag("palette") ?? "sail_blue";
const paletteNames = paletteArg === "all" ? Object.keys(PALETTES) : [paletteArg];

// ------------------------------------------------------------ PNG encoding

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}

/** rows of RGBA pixels -> a complete PNG file. */
function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // scanlines, each prefixed with filter byte 0 (None)
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rgba
      .subarray(y * width * 4, (y + 1) * width * 4)
      .forEach((v, i) => (raw[y * (1 + width * 4) + 1 + i] = v));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rasterize(
  map: SpriteMap,
  palette: SpritePalette,
  scale: number,
  bg: string | null,
): { width: number; height: number; rgba: Uint8Array } {
  const cols = Math.max(...map.map((r) => r.length));
  const width = cols * scale;
  const height = map.length * scale;
  const rgba = new Uint8Array(width * height * 4);
  const bgRgb = bg != null ? hexToRgb(bg) : null;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const key = map[Math.floor(y / scale)][Math.floor(x / scale)];
      const hex = key != null ? palette[key] : undefined;
      const rgb = hex != null ? hexToRgb(hex) : bgRgb;
      if (rgb == null) continue; // transparent, no background
      const o = (y * width + x) * 4;
      [rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]] = [...rgb, 255];
    }
  }
  return { width, height, rgba };
}

// ------------------------------------------------------------------- main

mkdirSync(outDir, { recursive: true });

for (const mapName of mapNames) {
  const map = SPRITE_MAPS[mapName];
  if (map == null) {
    console.error(
      `unknown map "${mapName}" — have: ${Object.keys(SPRITE_MAPS).join(", ")}`,
    );
    process.exit(1);
  }
  const widths = new Set(map.map((r) => r.length));
  if (widths.size > 1) {
    console.warn(
      `WARNING ${mapName}: rows have unequal widths (${[...widths].join(", ")}) — short rows truncate the render`,
    );
  }
  for (const paletteName of paletteNames) {
    const palette = PALETTES[paletteName];
    if (palette == null) {
      console.error(
        `unknown palette "${paletteName}" — have: ${Object.keys(PALETTES).join(", ")}, all`,
      );
      process.exit(1);
    }
    for (const scale of [px, 2]) {
      const { width, height, rgba } = rasterize(map, palette, scale, background);
      const file = join(outDir, `${mapName}-${paletteName}-px${scale}.png`);
      writeFileSync(file, encodePng(width, height, rgba));
      console.log(`${file}  (${width}x${height})`);
    }
  }
}
