# orion-docs

The documentation and marketing site for [Orion](../) — self-hosted
authentication for Node.js, with a cluster control plane.

Next.js 16 (App Router, Turbopack) · React 19 · Tailwind 4 · Nextra 4 ·
framer-motion · static export to Firebase Hosting.

> **Read [`DESIGN.md`](./DESIGN.md) before changing anything visual.**
> It is the design philosophy this site is built and maintained against — the
> colour and type systems, the motion rules, the drawing-office conceit, the
> release gate, and the reasoning behind each. This README tells you how to run
> the site; `DESIGN.md` tells you how to change it without breaking it.
>
> Also read [`AGENTS.md`](./AGENTS.md): this is **not** the Next.js you
> remember. Check `node_modules/next/dist/docs/` before reaching for an API from
> memory.

---

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
```

| Script | What it does |
|---|---|
| `npm run dev` | Turbopack dev server |
| `npm run lint` | ESLint — flat config, `next` + `react-hooks` rules |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Static export to `out/` |
| `npm run indexnow` | Notify Bing and other IndexNow participants after the new `out/` is deployed |

**All three checks must pass before you commit.** `lint` catches things `tsc`
does not — most notably `react-hooks/immutability`, which rejects mutating a
counter inside a `map` callback during render.

Deployment is Firebase Hosting, served from `out/`. Production redirects and
headers live in `firebase.json`.

### Publishing and search discovery

Build, deploy, then notify crawlers in that order:

```bash
npm run build
firebase deploy --only hosting
npm run indexnow
```

The last command submits only the canonical URLs generated in
`sitemap-main.xml`. Its public verification key is
`/bd9f20c681b34ee3880b54972864e0d1.txt`; it is intentionally public because
IndexNow verifies ownership by fetching it. Bing ownership verification remains
at `/BingSiteAuth.xml`.

### Build output you can ignore

- `⚠ Specified "redirects" will not automatically work with "output: export"` —
  expected. Those redirects are for `next dev`; `firebase.json` carries the real
  301s.
- `warn [nextra] Failed to get the last modified timestamp from Git` — this
  directory is not committed yet, so Nextra cannot read file history.

---

## Layout of the repository

```
app/                    Routes. Static export, so everything here is build-time.
  page.tsx              Home
  versions/             The edition system
    page.tsx            The timeline
    alpine/page.tsx     Edition 001 — issued poster or coming-soon plate
    alpine/docs/        Nextra mount point for content/
  opengraph-image.tsx   Social card, generated at build
  sitemap.ts robots.ts  Generated from the registries

components/
  ui/                   Primitives that know nothing about Orion
  layout/               Navbar, footer, sidebar, TOC, mobile drawer
  marketing/            Home hero and the 404 panel
  docs/                 Diagram + callout components used inside MDX
  versions/             Posters, timeline, ladder, sealed docket
  animations/           FadeIn, StaggerChildren, RevealText, page transitions
  background/           Grids, meshes, starfields, particles
  analytics/ seo/       Measurement and structured data; render nothing visible

content/                The documentation itself (MDX + _meta.ts ordering)
lib/                    The registries — see below
styles/                 tokens.css, prose.css, code.css
public/brand/           The Aperture mark, its cuts, and its construction spec
```

## The registries

Facts live in exactly one place. Components read them; they never restate them.

| File | Owns |
|---|---|
| `lib/versions.ts` | Editions — names, ordinals, dates, status, packages, stats, highlights |
| `lib/release-status.ts` | Whether the software and its source are public; the pending vocabulary |
| `lib/site-config.ts` | Site name, tagline, description, canonical URL, navigation |
| `lib/version-timeline.ts` | Geometry of the `/versions` drawing |
| `lib/hero-timeline.ts` | The hero's choreography |
| `lib/orion-stars.ts` | The constellation catalogue |
| `styles/tokens.css` | Every colour, size, radius, ease and duration |

Two constraints worth knowing before you touch `lib/`:

- **`lib/versions.ts` must stay import-alias-free.** `next.config.ts` imports it
  to derive the docs base path, and the config loads before the `@` alias
  resolves. Anything it imports must use relative paths too.
- **`siteConfig` has no `githubUrl`, on purpose.** Whether a public repository
  exists is a fact about the release, not the site — it lives behind the release
  gate. See below.

---

## Versioned documentation

Docs are versioned by edition, so **there is no bare `/docs`**. Every page hangs
off the edition that documents it:

```
/versions/alpine/docs/architecture/authentication
```

- Never write that prefix by hand. Use `docs("path")` from `lib/site-config.ts`,
  or `versionDocsRoute(edition)` when you were handed an edition.
- Editions get a literal folder each (`app/versions/alpine/`), not a `[slug]`
  route — a static segment and a dynamic sibling at the same level would leave
  the literal path matching the static branch and finding no page.
- Old `/docs/*` URLs redirect in **two** places that must change together:
  `next.config.ts` (for `next dev`) and `firebase.json` (for production).

### Adding an edition

1. Add an entry to `versions` in `lib/versions.ts`.
2. Snapshot the `content/` directory it documents.
3. Add `app/versions/<slug>/page.tsx` and a `docs/[[...mdxPath]]` folder.

The first two are the work. The third is a folder.

### Editing the documentation

Docs are MDX in `content/`, ordered and titled by sibling `_meta.ts` files.
Components (`Callout`, `Steps`, `Tabs`, `Timeline`, the diagrams) are registered
globally in `mdx-components.tsx` — do not import them in an MDX file; if one is
missing, register it there.

---

## The release gate

Orion is in its final phases. The documentation is published ahead of the
software, so the site must not claim the software is out or that its source is
public. **That entire state is two values.**

`lib/release-status.ts`:

```ts
export const source: SourceAvailability = {
  available: false,                              // → true on launch
  url: "https://github.com/aadk979/orion",
};
```

`lib/versions.ts`:

```ts
status: "pending",      // → "current" on launch
publishedOn: null,      // → the real ISO date
```

Flip those and the site launches: the hero badge starts pinging again, the
`/versions` heading returns to "Published editions", the Alpine page swaps its
coming-soon plate for the full poster with stats, highlights and the package
table, every GitHub affordance becomes a real link, and `codeRepository` /
`sameAs` come back into the structured data.

**If you find yourself editing a component to launch the site, that component is
reading the release state wrong — fix the component, not the copy.**

Two rules the gate enforces, spelled out because they are easy to undo by
accident:

- **Nothing pending may ping.** `animate-ping` is this site's "we are live"
  signal. Pending states use a hollow dashed ring or a blinking square.
- **A pending destination is not a disabled link — it is not a link.** A
  disabled link is still announced as a link and still invites a click.
  `SourceLink` renders inert text with an `sr-only` explanation, outside the tab
  order.

The full rationale, the vocabulary, the "coming soon" component set and the
launch checklist are in [`DESIGN.md` §9](./DESIGN.md#9-the-release-gate-and-the-pending-register)
and [§20](./DESIGN.md#20-the-launch-checklist).

---

## House rules, in brief

The long form is `DESIGN.md`. The short form:

1. The eye lands on the headline. Everything else is quieter than you think.
2. One amber accent. Labels on solid amber are ink, never white.
3. Mono means *data*. Uppercase + wide tracking + 10px + mono is an instrument
   label — all four properties, or none of them.
4. Every number on screen comes from a registry.
5. Motion establishes reading order and then stops. One slow, ignorable loop per
   page at most.
6. Reduced motion is honoured twice — in `globals.css` for CSS animations, and
   via `usePrefersReducedMotion()` for framer-motion.
7. Instrumentation disappears before content does when space runs short.
8. Never assert something untrue — not in copy, not in a link, not in JSON-LD,
   not with a pulsing dot.
9. Props crossing a `"use client"` boundary are serialised into the HTML whether
   or not they are rendered. Pass what you print, not the whole record.
10. Document the exception in the same commit as the exception.
