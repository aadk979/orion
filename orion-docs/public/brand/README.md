# Orion — the Aperture mark

Four arc segments on one circle, cut by four equal gaps, one segment in amber.
Reads as a letter O, as a shutter opening, and as a ring of nodes.

## Construction

| Property        | Value                  |
|-----------------|------------------------|
| Canvas          | 64 × 64 units          |
| Centre          | 32, 32                 |
| Path radius     | 20                     |
| Stroke          | 6, round cap           |
| Outer edge      | 23 from centre         |
| Inner edge      | 17 from centre         |
| Gap centres     | 0°, 90°, 180°, 270°    |
| Gap width       | 26° (±13°)             |
| Segment sweep   | 64° each               |
| Accent segment  | 283° → 347° (upper right) |

The accent segment never moves. One amber arc means one thing.

### Small cut (use below 24 px)

Radius 22, stroke 9, gaps widened to 34°. At the master cut the 26° gaps close
under antialiasing and the mark fills in to a solid ring. This is an optical
correction, not a second logo. Files: `svg/orion-icon-small*.svg`,
`favicon/favicon-16x16.png`, `favicon/favicon-32x32.png`.

## Colour

| Token                  | Hex     | Use                    |
|------------------------|---------|------------------------|
| `--orion-amber`        | #F0A02A | accent on dark grounds |
| `--orion-amber-strong` | #BA7517 | accent on light grounds|
| `--orion-bone`         | #EDEAE3 | mark on dark           |
| `--orion-ink`          | #14120E | mark on light, plates  |
| `--orion-page`         | #0B0A08 | page ground            |
| `--orion-muted`        | #6E6A61 | secondary text         |

Two ambers, not one. The bright value fails contrast on white.
`css/orion-tokens.css` ships both and swaps `--orion-accent` by colour scheme.

## Clear space

One gap width — 13 units at master scale, or 20% of the mark's height on any
side. Nothing enters it, including your own wordmark.

## HTML

Inline is the form to reach for; it is the only one that inherits colour.

```html
<a class="orion-lockup" href="/">
  <svg viewBox="0 0 64 64" width="28" height="28" fill="none"
       stroke-width="6" stroke-linecap="round" aria-hidden="true">
    <path d="M51.4874 36.4990 A20 20 0 0 1 36.4990 51.4874" stroke="currentColor"/>
    <path d="M27.5010 51.4874 A20 20 0 0 1 12.5126 36.4990" stroke="currentColor"/>
    <path d="M12.5126 27.5010 A20 20 0 0 1 27.5010 12.5126" stroke="currentColor"/>
    <path d="M36.4990 12.5126 A20 20 0 0 1 51.4874 27.5010" stroke="var(--orion-accent)"/>
  </svg>
  <span>ORION</span>
</a>
```

```css
.orion-lockup{ display:inline-flex; align-items:center; gap:.62em;
  color:var(--orion-bone); text-decoration:none; }
.orion-lockup span{ font:400 1.05rem/1 ui-monospace,SFMono-Regular,Menlo,monospace;
  letter-spacing:.18em; }
```

Head tags:

```html
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/png/apple-touch-icon-180.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#14120E">
```

`favicon.svg` carries its own `prefers-color-scheme` rule. `favicon.ico` holds
native 16 / 32 / 48 bitmaps, not one image downscaled three times.

Colour does not cross an `<img>` boundary — pick the matching `-on-dark` or
`-on-light` file, or use a CSS mask if you need one file to take any colour
(you lose the amber segment that way, so keep it out of the primary logo spot).

## Don't

- Rotate it. The accent marks a fixed position.
- Recolour more than one segment.
- Close the gaps to make it "cleaner". The gaps are the aperture.
- Add a padlock, shield, eye, or terminal prompt.
- Use the master cut under 24 px.
- Put the bright amber on white.
- Animate it as a spinner. Four segments on a circle is spinner grammar already,
  and a spinning logo on a monitoring tool reads as "not responding".

## Contents

```
index.html               spec sheet + usage, opens offline
README.md                this file
site.webmanifest         PWA manifest
css/orion-tokens.css     colour variables
svg/                     11 vector cuts (master, icon, small, mono, currentColor)
png/                     transparent raster 32–1024, both colourways, + touch icons
favicon/                 favicon.svg, favicon.ico, 16/32/48 png
```
