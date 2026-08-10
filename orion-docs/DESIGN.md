# The Orion documentation site — design philosophy

This document is the reason the site looks the way it does. It is written for
whoever maintains it next, including a future version of whoever wrote it, and
it exists because a design system that lives only in the CSS is a design system
that survives exactly one contributor.

Read it before adding a page, a component or a colour. If you find yourself
about to do something this document argues against, that is fine — but change
the document in the same commit, with the reason. **An undocumented exception is
how a system dies; a documented one is how it grows.**

---

## Contents

1. [The thesis](#1-the-thesis)
2. [Voice](#2-voice)
3. [Colour](#3-colour)
4. [Typography](#4-typography)
5. [Space, measure and layout](#5-space-measure-and-layout)
6. [Surface, border and depth](#6-surface-border-and-depth)
7. [The drawing-office conceit](#7-the-drawing-office-conceit)
8. [Motion](#8-motion)
9. [The release gate and the pending register](#9-the-release-gate-and-the-pending-register)
10. [Component contracts](#10-component-contracts)
11. [Documentation content](#11-documentation-content)
12. [Accessibility](#12-accessibility)
13. [Performance and the client boundary](#13-performance-and-the-client-boundary)
14. [Metadata and SEO](#14-metadata-and-seo)
15. [Single sources of truth](#15-single-sources-of-truth)
16. [Routing and versioned docs](#16-routing-and-versioned-docs)
17. [Working on the site](#17-working-on-the-site)
18. [Recipes](#18-recipes)
19. [The short version](#19-the-short-version)
20. [The launch checklist](#20-the-launch-checklist)

---

## 1. The thesis

**Orion is authentication infrastructure you run yourself. The site has to feel
like something an engineer would trust with their auth.**

Everything else follows from that sentence. Trust, in this context, is not built
by enthusiasm. It is built by precision, restraint, and a visible willingness to
state unflattering facts. So the site is:

- **Dark, warm and near-black.** Not a marketing gradient; a terminal you would
  leave open.
- **Almost monochrome.** One amber accent, used sparingly enough that when it
  appears you look at it.
- **Instrumented.** Rulers, registration marks, title blocks, coordinate
  readouts. The chrome of a drawing office, held at ten percent opacity.
- **Honest to a fault.** Every number on screen comes from a registry. Nothing
  is rounded up, invented, or implied. When something is not ready, the site
  says so in the same voice it uses for everything else.

The three failure modes to design against, in order of how easily they happen:

| Failure | What it looks like | The rule that prevents it |
|---|---|---|
| **Decoration** | Instrumentation you read before the headline | Chrome never exceeds `text-faint` / 10% alpha |
| **Enthusiasm** | Superlatives, pulsing dots, "blazing fast" | Claims are figures, and figures come from data |
| **Drift** | A second amber, a fifth radius, a hand-typed date | One registry per fact; tokens, never literals |

### The one-line test

Before shipping any screen, ask: *where does the eye land first?* It must be the
headline or the primary action. If it lands on a tick mark, a border, a badge or
an animation, something is too loud. The fix is almost always opacity, not
removal — the instrumentation is load-bearing for the feel, it just must not
compete.

---

## 2. Voice

The copy is as much of the design as the type is. It is written to one standard:
**a competent engineer explaining their own system to another engineer they
respect.**

### Rules

1. **State the fact, then the consequence.** "Postgres is the only hard
   dependency" beats "incredibly simple setup".
2. **Numbers over adjectives.** "35 auth endpoints, registered on boot" beats
   "comprehensive". If you cannot source the number from the registry or the
   code, do not use a number.
3. **Say what it refuses to do.** Alpine's summary lists the things Orion will
   not do — no hosted service, no key escrow. Constraints read as confidence.
4. **No exclamation marks. No "simply". No "just".** "Simply" is a load-bearing
   word that always means "I have not thought about your situation".
5. **Sentence case everywhere**, including headings and buttons. Title Case is
   for the wordmark and nothing else.
6. **Em dashes are allowed and used.** This is a voice with asides in it.
7. **British-leaning spelling in prose comments, American in UI copy** — the
   codebase already mixes them; do not spend a commit normalising it.
8. **Headings can have a full stop.** "What Alpine brought." reads as a
   statement rather than a link. Section headings do this; docs headings do not.

### Code comments are part of the voice

This codebase comments *why*, at length, and it is deliberate. Read
`components/versions/poster-plate.tsx` or `lib/versions.ts` for the register:
each non-obvious decision carries the alternative that was tried and the reason
it failed. Follow it. A comment that says *what* the next line does is noise; a
comment that says "the obvious way to write this is `top`, and it costs a layout
pass per frame" is the reason the next maintainer does not re-break it.

---

## 3. Colour

Defined once in `styles/tokens.css`, exposed to Tailwind through the
`@theme inline` block in `app/globals.css`. **Never write a hex value in a
component.** If you need a colour that does not exist, add a token and say why.

### The palette

The raw values come from the Aperture brand pack (`public/brand/README.md`), so
the logo and the UI cannot drift apart:

| Token | Value | Meaning |
|---|---|---|
| `--orion-page` | `#0B0A08` | The page ground. Warm near-black, not grey. |
| `--orion-ink` | `#14120E` | Elevated surfaces and the mark's plate. |
| `--orion-bone` | `#EDEAE3` | Primary text. Warm off-white, never `#fff`. |
| `--orion-muted` | `#6E6A61` | Tertiary text. |
| `--orion-amber` | `#F0A02A` | The accent. |
| `--orion-amber-strong` | `#BA7517` | The accent on light grounds — used as `accent-dim`. |

Derived, and what you actually use in components:

- **Surfaces:** `bg`, `bg-raised`, `bg-elevated`, `bg-overlay` — four steps,
  each warming towards ink. Nothing on this site is grey.
- **Text:** `text-primary` → `text-secondary` → `text-tertiary` →
  `text-faint`. Four steps and no more. `text-tertiary` is the functional muted
  tier and clears AA on the page ground; `text-faint` is the instrumentation
  tier and is *supposed* to be hard to read, so it never carries unique or
  interactive information.
- **Borders:** `border-faint` (6%), `border` (10%), `border-strong` (16%) —
  bone at low alpha, so hairlines stay warm rather than going blue-grey.
- **Accent:** `accent`, `accent-bright` (hover/link), `accent-dim`,
  `accent-contrast`.

### The rules

- **One accent.** There is no secondary brand colour and there will not be one.
  Emerald and amber tones exist on `Badge` for `success`/`warning` semantics
  only — status, never decoration.
- **Amber is a highlight, not a fill.** Large amber areas are wrong. The accent
  appears as: a 1px rule, a small marker, a link, one filled button per screen,
  a registration mark, a stamp.
- **`--color-accent-contrast` is ink, not white.** White on amber is 2.15:1 and
  fails AA outright; ink reaches 8.8:1. Any solid-accent surface puts its label
  in `accent-contrast`. This is not negotiable and it is the single easiest
  accessibility mistake to make on this site.
- **Dark mode only.** There is no light theme, `color-scheme` is pinned, and the
  tokens assume a dark ground throughout. Adding a light theme is a project, not
  a patch — it means re-deriving every alpha value, because bone-at-10% on ink
  is not the same relationship as ink-at-10% on bone.
- **Transparency over new tokens.** `bg-white/[0.03]` for a barely-raised
  surface is idiomatic here and preferred to inventing `--color-bg-raised-2`.

---

## 4. Typography

Two families, both from `next/font/google`, both loaded as variables:

- **Geist Sans** (`--font-sans`) — everything you read.
- **Geist Mono** (`--font-mono`) — everything you *measure*: figures, labels,
  file numbers, tick values, version strings, timestamps, code.

The split is semantic, not aesthetic. **Mono means "this is data".** If you set
prose in mono to make it look technical, you have broken the signal that makes
the instrumentation legible as instrumentation.

`font-feature-settings: "cv02", "cv03", "cv04", "cv11"` is set on `body` —
Geist's single-storey alternates. Do not remove it; the site's numerals and
lowercase `g`/`l` are tuned around it.

### The scale

`--text-xs` (0.75rem) through `--text-7xl` (5.5rem), defined in tokens. Display
sizes above `7xl` are set with arbitrary values (`lg:text-[7.5rem]`) because
they are one-offs on posters and do not belong in a shared scale.

### Tracking is a function of size

- Display (`text-5xl`+): `tracking-tighter` (-0.045em). Large type needs
  negative tracking or it falls apart.
- Headings: `tracking-tight` (-0.03em).
- Body: normal.
- **Instrumentation: `tracking-wide` (0.04em), uppercase, mono, and tiny**
  (`text-[0.55rem]` to `text-[0.65rem]`). This combination is the site's
  signature. Uppercase mono at 10px with positive tracking reads as a label on
  an instrument; any one of those four properties missing and it reads as small
  text.
- Stamps: extreme tracking (`0.22em`–`0.3em`). See §9.

### Other typographic rules

- **`text-balance` on every headline.** Widows in a two-line headline are
  visible at display size.
- **`tabular-nums` on anything that changes** — coordinate readouts, version
  numbers in tables, ordinals. Proportional digits jitter.
- **Reading measure is `--width-prose` (900px)** and it applies to body copy
  *only*. Tables, code blocks and diagrams break out to the full column. This is
  implemented in `styles/prose.css` by scoping `max-width` to `> p, > ul, > ol,
  > blockquote` rather than to the container — a detail worth preserving.
- **Marketing copy caps at `max-w-2xl`/`max-w-xl`** by hand.

---

## 5. Space, measure and layout

### Three widths, and no others

| Token | Value | Used by |
|---|---|---|
| `--width-content` | 1120px | Marketing pages, the versions timeline, footers |
| `--width-docs` | 1720px | The three-column docs shell only |
| `--width-prose` | 900px | Body copy inside an article |

The navbar switches between the first two based on the route, so its logo and
actions line up with the sidebar and TOC gutters on docs pages. That check lives
in `components/layout/navbar.tsx` as `DOCS_ROUTE_RE` and must keep matching
`/versions/<edition>/docs` for *any* edition, not just the current one.

### Section rhythm

`Section` takes `size="sm" | "md" | "lg"`, mapping to `--space-section-*`
(4/6/9rem) above `md`, with a smaller mobile fallback. **Do not hand-set
vertical padding on a section.** If a section needs an unusual rhythm, that is a
signal it wants to break out of `Section` entirely (as the timeline does, so its
atmosphere can run edge to edge while its drawing stays on the content measure).

### Spacing inside a block

Tailwind's default scale, with a strong preference for the rhythm the posters
already use: `mt-4` between an element and its own caption, `mt-6`–`mt-9`
between related blocks, `mt-14` before a trailing block of small type.

`--height-nav` is 64px and is referenced, never hard-coded — every
`scroll-mt-(--height-nav)` and `pt-[calc(var(--height-nav)+…)]` depends on it.

---

## 6. Surface, border and depth

- **Hairlines do the work.** This site separates things with 1px rules far more
  often than with background changes or shadows. A `border-faint` rule between
  two rows is the default; a raised surface is the exception.
- **Radii**: `xs` 4px through `xl` 24px, plus `full`. Cards are `lg` (16px),
  controls are `full` (pills), small inline chrome is `xs`/`sm`. **Instrument
  chrome is square.** Title blocks, tick marks, stamps and the docket's status
  cells have no radius at all — that is what makes them read as drawn rather
  than as UI.
- **Shadows are for elevation, never for style.** `--shadow-lg` exists for
  overlays and drawers. Cards do not have shadows; they have borders.
- **`--shadow-glow`** is the one decorative shadow, reserved for the current
  edition's marker on the timeline and solid accent buttons.
- **Backdrop blur is used at 2–12px** on things that float over content
  (navbar when scrolled, title block, timeline plates). It is always paired with
  a translucent background, never used alone.

---

## 7. The drawing-office conceit

The site's organising metaphor: **Orion is infrastructure, and every edition
page is a drawing filed in an office.**

That is where the ruled borders, the registration marks, the graduated scale,
the title block in the bottom-right corner, the giant ordinal set as a type
specimen with its construction geometry showing, and the coordinate reticle all
come from. It lives in `components/versions/poster-plate.tsx`, shared by both
the issued poster and the pending one.

### Why it works, and the rules that keep it working

1. **Every value is real.** The sheet number, the issue date, the span in days —
   all from `lib/versions.ts`. A spec sheet that lies about its own measurements
   is just a texture, and readers can tell.
2. **It never competes.** Bone at 5–12% alpha, 10px mono. The reticle is gated
   on an actual pointer (`(hover: hover) and (min-width: 1024px)`) because on a
   touch screen it would pin itself wherever the last tap landed and read as a
   rendering bug.
3. **It degrades by disappearing.** The title block is hidden below `lg`; the
   edge scale below `md`. Everything they show is repeated in the page's own
   copy, so nothing is lost. Instrumentation is the first thing to go when space
   is short — never the content.
4. **The geometry is honest.** Ticks are positioned in percentages, not drawn
   with a repeating gradient, because a gradient repeats on a pixel pitch while
   the labels sit on percentages: they agree at exactly one viewport width and
   visibly drift at every other. This is the kind of thing to preserve.

If you extend the conceit, extend it in the same direction — a records office,
a plan chest, a filing system. Do not add a second metaphor.

---

## 8. Motion

Motion on this site is **choreography, not decoration**. It has a job: to
establish reading order, and to make the instrumentation feel drawn rather than
faded in.

### The tokens

`lib/motion.ts` mirrors the cubic-béziers in `tokens.css`. Use the named eases,
never a raw array:

- `ease.outExpo` — arrivals. The default for anything entering.
- `ease.outQuart` — lines being drawn (frame edges, dimension rules).
- `ease.spring` / `springTransition` — interactive feedback only (button
  hover/tap).
- `ease.inOut` — sweeps and traversals.

Durations: `fast` 150ms (colour transitions), `base` 250ms, `slow` 450ms
(entrances), `slower` 800ms (long draws).

### The rules

1. **Nothing waits on anything.** The hero used to run 4.5 seconds of
   choreography before the page said what it was; the fix was a two-column
   layout, not faster animation. Every cue table in the codebase (`cue` in
   `lib/hero-timeline.ts`, `posterCue` in `poster-plate.tsx`) is tuned so the
   whole screen is legible inside one second.
2. **Looping motion must be ignorable.** The read-in sweep runs **once**. A loop
   there would put something blinking in the reader's peripheral vision for as
   long as they stay on the page. The only permitted loops are slow, low
   contrast and long-period: the raking light (9s + 5s delay), the timeline
   pulse (7s), the grid drift.
3. **Animate transforms and opacity. Nothing else.** The sweep moves a
   full-height carrier by a percentage of its own height rather than animating
   `top`, because `top` is a layout property and costs a layout pass per frame.
   Same reason `AnimatedGrid` pans with `translate3d` over exactly one cell
   rather than animating `background-position`.
4. **Draw lines along their own axis.** Scaling a 1px rule on both axes collapses
   its thickness to nothing and grows it back, which reads as fading in and
   undoes the point of drawing it.
5. **Motion values, not state, for pointer tracking.** The reticle writes
   straight to the DOM through `useMotionValueEvent`; pointer position in React
   state would re-render the whole poster on every mouse move.
6. **Hydration safety.** Any number rendered from a motion value must
   server-render its motion value's *initial* (hence the literal `0.500` in
   `Readout`). Any date-derived figure must come from fixed registry dates,
   never `Date.now()` — a figure that moves between server and client render is
   a hydration mismatch, and one that moves between builds is a diff nobody
   asked for.

### Reduced motion

Two layers, and you need both:

- **CSS**: `app/globals.css` neutralises all CSS animations and transitions
  under `prefers-reduced-motion: reduce`. This covers Tailwind's `animate-*`.
- **JS**: `usePrefersReducedMotion()` from `hooks/use-media-query.ts`. Every
  framer-motion component takes it and collapses to either a short fade or
  `initial={false}`.

The pattern throughout is `initial={reduceMotion ? false : {…}}`. Honour it in
anything new. Reduced motion is not "the same animation, faster" — a hard
landing in the corner of the eye is exactly what the preference is asking you
not to do.

---

## 9. The release gate and the pending register

This is the newest subsystem and the one most likely to be misunderstood, so it
gets the longest section.

### The problem

Orion is finishing its final phases. The documentation is complete enough to
publish; the software and its repository are not. A documentation site that
ships before its software will, by default, lie: it links a repository that
404s, prints a publication date that has not happened, and pings a little green
dot that means "we are live".

### The solution: one switch

`lib/release-status.ts` holds the entire release state:

```ts
export const source: SourceAvailability = {
  available: false,
  url: "https://github.com/aadk979/orion",
};

export const pendingCopy = { stamp, source, sealed, awaiting, date, status };
```

`lib/versions.ts` holds the other half: a `"pending"` status and a nullable
`publishedOn`.

**Launching the site is two data edits and nothing else:**

1. `source.available` → `true`.
2. Alpine's `status` → `"current"` and `publishedOn` → a real ISO date.

If you ever find yourself editing a *component* to launch the site, that
component is reading the release state wrong. Fix the component.

### Why the types are shaped the way they are

- `publishedOn` is `string | null`, not optional and not a placeholder date.
  Every surface that wants to print a date is forced by the compiler to decide
  what it shows when there is not one. That is why no "Invalid Date" can reach a
  reader.
- `SourceAvailability` is a **declared union**, not an inferred literal. Inferred
  from `{ available: false }`, the `true` branch of every `source.available ?`
  in the site would stop being type-checked — and that is precisely the branch
  that has to work on launch day.
- `developmentDays()` returns `number | null` for the same reason. An
  open-ended span measured against today would change on every rebuild.
- `publicationLabel()` exists so "pending" is worded *identically* in the
  poster, the thread, the ladder and the card. Formatting `publishedOn` at a
  call site is how a fifth wording appears.

### The register

The pending state speaks in the voice of a **records office**: editions are
numbered files that are *opened*, *held*, *cleared* and *issued*. It is a
deliberate one-step extension of the drafting-room chrome the site already had —
the room where the drawings are filed.

The vocabulary is fixed in `pendingCopy` so the whole site sounds like one
institution. `SEALED` in one place and "hidden for now" in another is two
institutions, and the effect depends entirely on there being one.

> **Originality constraint.** The register is generic on purpose — forms,
> stamps, dockets, clearances, file numbers. It borrows no names, marks, mottos,
> mascots, slogans or livery from anyone else's work, and it must not start to.
> If a proposed addition only makes sense as a reference to a specific film or
> series, it does not belong here. The bureaucratic-retro *idiom* is common
> property; a particular organisation's identity is not.

### The three components

**`components/ui/stamp.tsx` — the rubber stamp.**

The one loud object in the register, and it works because it is rare. Three
properties make it read as ink rather than as a UI chip, and dropping any one
turns it back into a badge:

1. **The cant** — a few degrees off true, rotating border, rules and text as one
   impression. Past about 8° it reads as broken.
2. **The double rule** — an outer frame and an inner hairline with a sliver of
   ground between them. That gap is the tell.
3. **The unevenness** — an inline SVG turbulence at `soft-light`, and the whole
   stamp held just under full opacity. Ink does not land flat.

Its motion is a single hard landing (down, slightly overscaled, arriving with no
overshoot) and then absolute stillness. Anything that keeps moving afterwards
reads as a sticker. `impact={false}` opts out for inline uses.

**Budget: at most one stamp per screen region, and never in fixed chrome at full
volume.** The navbar's source affordance deliberately uses a quiet bordered
`Soon` instead — a stamp repeated on every page stops being an event and starts
being a logo, which is how a "coming soon" becomes invisible.

**`components/versions/pending-poster.tsx` — the coming-soon plate.**

The same sheet as the issued poster, printed before there was anything to print
on it. It answers exactly one question — *is it out?* — and refuses every other:
no version numbers, no manifest, no change list, no date, not even the tagline.

The design argument, worth internalising: **a "coming soon" page that lists what
is coming is not a coming-soon page.** It is a spec sheet with a delay attached,
and it invites the reader to evaluate something they cannot have.

But withholding is only legible if the page *shows* that it is withholding — a
blank screen reads as unfinished, not as sealed. Hence:

**`components/versions/sealed-docket.tsx` — the redaction.**

Labels stay, values are struck. Five sealed rows exist to make the sixth, open
row — the documentation — mean something. A page that only says "no" gives a
reader nothing to do.

On a near-black ground the obvious redaction (a black bar) is an invisible bar,
so the strike is inverted: a fine diagonal hatch in bone at very low alpha, with
the status word set over it. Hatched reads as *covered*; empty reads as *broken*.

### The client-boundary rule (important)

`PendingPoster` takes four scalars — `ordinal`, `name`, `docsHref` — and **not**
an `OrionVersion`.

This is not style. It is a client component, so anything handed to it is
serialised into the page's RSC payload and shipped inside the HTML *whether or
not it is rendered*. Passing the whole edition record put the sealed manifest,
the change list and the summary into `versions/alpine.html` in plain text, on
the one page whose entire job is not to show them.

**The prop boundary is the redaction.** The component receives exactly what it
prints and has no access to the rest, so the withholding cannot be undone by a
later edit to that file. Apply the same reasoning to anything else that must not
appear on a page: crossing a client boundary publishes it.

(The remaining `github.com/...` string in a JS chunk is the held `source.url`
reaching the bundle through client components that import `pendingCopy` from the
same module. It is an unrendered constant for a predictable public URL, and is
accepted rather than worked around.)

### Where the pending state surfaces

| Surface | Issued | Pending |
|---|---|---|
| Home hero badge | Accent badge with pinging dot | Bordered pill, quiet `Coming soon` stamp, links to the edition |
| Home closing CTA | "Point a node at Postgres…" | "…the documentation is complete and open" |
| Navbar / footer / drawer | Real GitHub link | Dimmed mark, `Soon` / `Coming soon`, **not a link** |
| `/versions` heading | "Published editions" | "Editions on file" |
| `/versions` card | Badge + date + package versions | Stamp + `Issue Pending` + sealed manifest line |
| Timeline node | Filled, glowing, pinging | Hollow dashed ring, "Not yet issued" |
| `/versions/alpine` | Full poster, stats, highlights, packages | Coming-soon plate, sealed docket, docs CTA |
| JSON-LD | `codeRepository`, `sameAs` | Properties omitted entirely |
| 404 "report it" | Prefilled GitHub issue link | Inert sentence explaining when it opens |

Note the two absolute prohibitions:

- **Nothing pending may ping.** `animate-ping` is the site's "we are live"
  signal. The pending node is a hollow dashed ring; the pending badge blinks a
  square instead. A pinging dot on a pre-release page is the exact lie this
  whole subsystem exists to prevent.
- **A pending destination is not a disabled link — it is not a link.** A
  disabled link is still a link to a keyboard, still announced as one by a
  screen reader, and still something a reader will click twice before concluding
  the site is broken. `SourceLink` renders inert text with an `sr-only`
  sentence, outside the tab order.

---

## 10. Component contracts

`components/` is organised by role, and the folder tells you what a thing is
allowed to know:

```
components/
  ui/          Primitives. Know nothing about Orion. Reusable anywhere.
  layout/      The shell: navbar, footer, sidebar, TOC, drawer.
  marketing/   Home and 404 — the pages that sell rather than explain.
  docs/        Diagram and callout components used inside MDX.
  versions/    The edition system: posters, timeline, docket.
  animations/  Reusable entrance wrappers.
  background/  Atmosphere: grids, meshes, starfields, particles.
  analytics/   Measurement. Renders nothing.
  seo/         Structured data. Renders nothing visible.
```

### Which primitive to reach for

| Need | Use | Do not |
|---|---|---|
| An action | `Button` (`primary` / `secondary` / `ghost`, `sm`/`md`/`lg`) | Hand-roll a link with button classes |
| A status label | `Badge` (`neutral`/`accent`/`success`/`warning`) | Invent a coloured pill |
| Something *stamped* | `Stamp` | `Badge` with tracking |
| A figure with a caption | `MetricCard` | A `<div>` with two spans |
| A titled block of prose | `Card` + `CardTitle` + `CardDescription` | A bordered div |
| An aside in docs | `Callout` (`info`/`warning`) | Bold text |
| A section of a page | `Section` + `SectionHeading` | Manual padding |
| A responsive column set | `Grid columns={2|3|4}` | Ad-hoc `grid-cols-*` |
| An entrance | `FadeIn` / `StaggerChildren` / `RevealText` | A bespoke `motion.div` |

**One filled `primary` button per screen region.** If two things are equally
important, neither is.

### Adding a primitive

A new component belongs in `ui/` only if it knows nothing about Orion. If it
imports from `lib/versions.ts` or `lib/release-status.ts`, it belongs in the
folder for the subsystem it serves. `Stamp` is in `ui/` (it stamps anything);
`SourceLink` is in `ui/` but imports the gate, which is the one deliberate
exception — it is the gate's *presentation*, and putting it anywhere else would
mean three copies of it.

Every new component gets a doc comment that answers: what it is, why it looks
like that, and what was tried and rejected.

---

## 11. Documentation content

Docs live in `content/**/*.mdx` and are rendered by Nextra 4 through
`app/versions/alpine/docs/[[...mdxPath]]/page.tsx`. Ordering and titles come
from `_meta.ts` files.

- **Typography is hand-rolled** in `styles/prose.css`, scoped to `.prose-orion`,
  deliberately *not* `@tailwindcss/typography` — it is tuned to Orion's tokens.
- **Code blocks** are Shiki via `rehype-pretty-code` (`github-dark-default`,
  background stripped), styled in `styles/code.css`; the chrome (filename tab,
  copy button, wrap toggle) is `components/ui/code-block.tsx`.
- **MDX components** are registered globally in `mdx-components.tsx` — `Callout`,
  `Steps`, `Tabs`, `Timeline`, the diagram components. Import nothing in an MDX
  file; if a component is not registered, register it.
- **Docs prose is instructional, not promotional.** No headline full stops, no
  poster voice. The marketing register stops at the docs boundary.
- **Every claim in the docs must be true of the current build.** The
  documentation is published ahead of the software, which makes this harder, not
  optional — see the Alpine callouts in `content/index.mdx` and
  `content/roadmap/index.mdx` for the pattern: state the status, then continue.

---

## 12. Accessibility

Non-negotiable, and mostly already solved — keep it that way.

- **Contrast.** `text-primary` and `text-secondary` clear AA on the page ground.
  `text-tertiary` is for supporting copy. **`text-faint` is decorative
  instrumentation and must never carry information that is not repeated
  elsewhere** — this is the rule that makes the whole low-contrast chrome
  defensible.
- **Accent contrast.** Label anything solid-amber with `accent-contrast` (ink).
  See §3.
- **Focus.** A global `:focus-visible` outline in amber with 2px offset. Never
  remove it. Custom interactive elements add
  `group-focus-visible:ring-2 group-focus-visible:ring-accent/40` on the visible
  part, as the timeline nodes do.
- **Real elements.** The timeline's nodes are `<a>` elements in an HTML layer
  above the SVG, not `<circle>`s with click handlers. Keyboard and screen-reader
  users get the same timeline everyone else does. Keep that architecture.
- **Split text needs a label.** Any per-character animated heading sets
  `aria-label` on the heading and `aria-hidden` on the glyph spans.
- **Decoration is hidden.** Every backdrop, plate, reticle and grid carries
  `aria-hidden`.
- **Icons need names.** Icon-only controls get an `sr-only` label or
  `aria-label`.
- **Reduced motion is honoured twice.** See §8.
- **Visual-only signals need words.** The stamp is visual; `SourceLink` pairs it
  with an `sr-only` sentence, because "Coming soon" read aloud out of context
  does not say *what* is coming.

---

## 13. Performance and the client boundary

The site is a **static export** (`output: "export"`). There is no server at
runtime. Everything in `lib/seo.ts`, the sitemap, the robots file and all page
metadata is computed at build time and ships as plain markup — which is exactly
what a crawler that does not execute JavaScript needs to see.

### Server by default

A component is a server component unless it needs a hook, an event handler or a
browser API. `"use client"` at the top of a file marks a boundary; everything
that file imports joins the client bundle.

Consequences to hold in your head:

1. **Props crossing the boundary are serialised into the HTML.** See §9 — this
   is a correctness concern, not only a size one.
2. **Importing a module for one helper pulls the whole module client-side.**
   `lib/versions.ts` is in the client bundle because client components need
   `currentVersion` and the label helpers.
3. **`lib/versions.ts` must stay alias-free.** `next.config.ts` imports it to
   derive the docs base path, and the config is loaded before the `@` alias is
   resolvable. Anything it imports must use relative paths too. This has bitten
   before and will again.

### Rendering cost

- Animate transforms and opacity only (§8).
- Prefer a wide, low-opacity duplicate stroke to a blur filter — the timeline's
  bloom is a 10px-wide copy at 10% opacity because a real blur re-rasterises
  every frame the pulse runs.
- Canvas backgrounds (`starfield`, `particle`) must be capped, paused off-screen
  and dropped under reduced motion.
- Inline small SVG textures as data URIs. A texture that 404s is a flat chip.

---

## 14. Metadata and SEO

`lib/seo.ts` is the only place page metadata is shaped. Every route calls
`pageMetadata({ title, description, path })`.

- **The canonical is the point.** A static export is served as files, so the same
  page is reachable as `/x`, `/x/` and `/x.html`. Naming one canonical on every
  route is what stops that becoming duplicate content.
- **Open Graph has no title template**, so `pageMetadata` spells out the
  qualified form. Do not remove that.
- **Structured data is linked by `@id`**, not repeated: `Organization` and
  `WebSite` are defined once in the root layout and referenced from every page's
  `TechArticle` or `SoftwareApplication`.
- **Never assert a URL that does not resolve.** `sameAs`, `codeRepository` and
  the author URL are omitted while the source is unavailable. An omitted
  property is better metadata than a vouched-for 404.
- **A pending page's `description` must describe what the page shows.** Alpine's
  metadata does not use its summary while pending; shipping the withheld pitch
  into every search result and social card withholds nothing at all.

---

## 15. Single sources of truth

The site has exactly these registries. Facts live in one of them, never in a
component:

| File | Owns |
|---|---|
| `lib/versions.ts` | Editions: names, ordinals, dates, status, packages, stats, highlights |
| `lib/release-status.ts` | Whether the software and its source are public; the pending vocabulary |
| `lib/site-config.ts` | Site name, tagline, description, canonical URL, nav trees |
| `lib/version-timeline.ts` | The geometry of the `/versions` drawing |
| `lib/hero-timeline.ts` | The hero's choreography |
| `lib/orion-stars.ts` | The constellation catalogue |
| `styles/tokens.css` | Every colour, size, radius, ease and duration |
| `public/brand/README.md` | The mark's construction and clear space |

Note the deliberate absence: **`siteConfig` has no `githubUrl`.** Whether there
*is* a public repository is a fact about the release, not about the site, so it
lives behind the gate. A bare `githubUrl` on the config object is an invitation
to link a 404 — which is how the site came to claim it was open before it was.

---

## 16. Routing and versioned docs

Docs are versioned by edition. **There is no bare `/docs`** — every page hangs
off the edition that documents it, at `/versions/<slug>/docs/...`.

- `lib/versions.ts` is where that fact is written down. `siteConfig.docsBasePath`,
  Nextra's `contentDirBasePath`, the timeline and every poster derive from it.
- Nothing writes the docs prefix by hand: use `docs("path")` from
  `lib/site-config.ts`, or `versionDocsRoute(edition)` when you were handed an
  edition rather than the current one.
- Editions get a **literal folder each** (`app/versions/alpine/`), not a
  `[slug]` route — a static segment and a dynamic sibling at the same level
  leaves the literal path matching the static branch and finding no page.
- **Legacy `/docs` URLs are redirected in two places** — `next.config.ts` (for
  `next dev`) and `firebase.json` (the 301s that actually reach a visitor,
  because a static export has no server). Both lists change together.
- `currentVersion` prefers a `"current"` edition, then a `"pending"` one, then
  the first. The pending fallback is load-bearing: documentation is published
  ahead of the software, and falling through to "no edition" would take every
  docs route down with it.

### Adding an edition

1. Add an entry to `versions` in `lib/versions.ts`.
2. Snapshot the `content/` directory it documents.
3. Add `app/versions/<slug>/page.tsx` and a `docs/[[...mdxPath]]` folder.

The first two are the work. The third is a folder.

---

## 17. Working on the site

```bash
npm run dev        # Turbopack dev server on :3000
npm run lint       # ESLint (flat config, next + react-hooks rules)
npm run typecheck  # tsc --noEmit
npm run build      # static export to out/
```

**All three checks must pass before a commit.** `lint` in particular catches
things `tsc` will not — notably `react-hooks/immutability`, which rejects
mutating a counter inside a `map` callback during render. (Precompute the
offsets at module scope instead; `HEADLINE_WORDS` in `pending-poster.tsx` is the
worked example.)

Deployment is Firebase Hosting from `out/`. `firebase.json` holds the production
redirects and headers.

### Known-benign build output

- `⚠ Specified "redirects" will not automatically work with "output: export"` —
  expected; those redirects are for `next dev` only, and `firebase.json` carries
  the real ones.
- `warn [nextra] Failed to get the last modified timestamp from Git` — the docs
  site is not committed to the repository yet, so Nextra cannot read a file's
  history. It disappears once the directory is tracked.

### The Next.js version

`AGENTS.md` at the site root says it plainly: **this is not the Next.js you
know.** Next 16 with Turbopack, React 19, Tailwind 4 and Nextra 4 all differ
from older conventions. Read `node_modules/next/dist/docs/` before reaching for
a remembered API, and heed deprecation notices.

---

## 18. Recipes

### Add a marketing section

```tsx
<Section id="thing" size="md">
  <SectionHeading
    eyebrow="Two or three words"
    title="One sentence, sentence case, with a full stop."
    description="One or two sentences of supporting detail. No superlatives."
  />
  <FadeIn>{/* or <StaggerChildren><Grid columns={3}> */}</FadeIn>
</Section>
```

### Add a figure

Put it in `lib/versions.ts` under the edition's `stats`, then render with
`MetricCard`. Never hard-code a number in JSX.

### Mark something as not-yet-available

Import `pendingCopy` from `lib/release-status.ts` and use its words. If the thing
is a destination, follow `SourceLink`: render inert text, not a disabled link,
and pair any visual-only marker with an `sr-only` sentence.

### Add a stamp

Ask first whether the screen already has one. If it does, use quiet chrome
instead — a bordered mono label. If it does not, `<Stamp size="md">` with
`rotate` between −6 and −2, and `impact={false}` anywhere a landing beat would
be noise.

### Add an entrance animation

Use `FadeIn` or `StaggerChildren`. If you need bespoke choreography, take
`usePrefersReducedMotion()`, define a `cue` table of delays at the top of the
file, and keep the whole sequence under one second.

---

## 19. The short version

If you remember nothing else:

1. **The eye lands on the headline.** Everything else is quieter than you think.
2. **One amber.** Ink on amber, never white.
3. **Mono means data.** Uppercase + wide tracking + 10px + mono = an instrument
   label. All four, or none.
4. **Every number comes from a registry.**
5. **Facts live in one file.** Components read; they do not know.
6. **Motion establishes reading order, then stops.** One loop per page, slow and
   ignorable.
7. **Reduced motion is honoured in CSS *and* in JS.**
8. **Instrumentation disappears before content does.**
9. **Never assert something untrue** — not in copy, not in a link, not in
   JSON-LD, not with a pinging dot.
10. **Crossing a client boundary publishes the props.** Pass what you print.
11. **Document the exception in the same commit as the exception.**

---

## 20. The launch checklist

When Alpine is issued:

- [ ] `lib/release-status.ts` — `source.available` → `true`.
- [ ] `lib/versions.ts` — Alpine's `status` → `"current"`, `publishedOn` → the
      real ISO date.
- [ ] `npm run build`, then confirm: the hero badge pings again; `/versions`
      reads "Published editions"; `/versions/alpine` renders the full poster with
      stats, highlights and the package table; the navbar, footer and drawer link
      to the repository; `codeRepository` and `sameAs` are back in the JSON-LD;
      the 404 panel offers a prefilled issue link.
- [ ] `content/roadmap/index.mdx` — remove the "Alpine has not been issued yet"
      callout.
- [ ] `content/index.mdx` — drop the trailing sentence about edition 001.
- [ ] `content/security/disclosure.mdx` — promote the private security advisory
      channel to the primary route.
- [ ] Confirm nothing anywhere still says "coming soon":
      `grep -ri "coming soon\|not yet issued\|sealed" app components content`.

Everything on that list except the two data edits is copy that could only ever
have been written by hand. That is the residue the gate cannot absorb, and it is
short on purpose — keep it that way.
