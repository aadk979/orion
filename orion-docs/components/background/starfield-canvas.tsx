"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/use-media-query";
import type { MousePosition } from "@/hooks/use-mouse-position";
import {
  ORION_EDGES,
  ORION_HALF_HEIGHT,
  ORION_HALF_WIDTH,
  ORION_RADIUS_DEGREES,
  ORIONID_RADIANT,
  PROJECTED_ORION,
  magnitudeToBrightness,
} from "@/lib/orion-stars";
import {
  EDGE_DRAW_MS,
  EDGE_STAGGER_MS,
  EDGE_START_MS,
  IGNITE_MS,
  IGNITE_STAGGER_MS,
  IGNITE_START_MS,
  SKY_END_MS,
} from "@/lib/hero-timeline";

/**
 * The hero starfield.
 *
 * A 3D point cloud rendered to a 2D canvas: field stars scattered through a
 * depth volume, with the real Orion constellation sitting on a near-flat plane
 * inside it so the figure stays readable while the camera moves. On mount the
 * camera dollies in, the constellation ignites brightest-star-first, and the
 * asterism traces itself between them.
 *
 * Canvas 2D rather than WebGL on purpose. WebGL wins above a few thousand
 * points, but this tops out around 1,400 and stays comfortably at 60fps by
 * blitting pre-rendered glow sprites instead of calling `arc()` per star —
 * which buys us the whole effect for zero bundle weight and no fallback path.
 */

type StarTone = "amber" | "blue" | "bone";

type FieldStar = {
  x: number;
  y: number;
  z: number;
  radius: number;
  brightness: number;
  tone: StarTone;
  twinklePhase: number;
  twinkleRate: number;
  /** ms after mount that this star fades in. */
  appearAt: number;
};

type ConstellationStar = {
  x: number;
  y: number;
  z: number;
  radius: number;
  brightness: number;
  tone: StarTone;
  igniteAt: number;
  twinklePhase: number;
  twinkleRate: number;
};

/** Matches `--orion-amber`; overridden from the live token on mount. */
const TONE_RGB: Record<StarTone, [number, number, number]> = {
  amber: [240, 160, 42],
  blue: [186, 211, 255],
  bone: [237, 234, 227],
};

const FIELD_STAR_DENSITY = 0.00016;
const MAX_FIELD_STARS = 1600;
const MIN_FIELD_STARS = 400;

/**
 * Half-extent of the field-star volume in model units. Field stars are scaled
 * independently of the constellation so they always cover the canvas no matter
 * how large or small the figure is drawn — otherwise anchoring the figure into
 * a corner drags the whole starfield after it and leaves the rest of the hero
 * empty.
 */
const FIELD_SPREAD_X = 2.1;
const FIELD_SPREAD_Y = 1.7;
/** A little past the edges, so the outermost stars aren't a visible boundary. */
const FIELD_OVERSCAN = 1.08;

/** Camera focal length. Animated from FOCAL_START for the opening dolly. */
const FOCAL = 2.4;
const FOCAL_START = 4.1;
const DOLLY_MS = 2600;

/* ---- Meteors ------------------------------------------------------------
 *
 * The Orionids, drawn with the shower's actual behaviour rather than a stock
 * "shooting star" tween:
 *
 *   - They stream out of the real radiant (06h 21m, +15.6°), which sits inside
 *     Orion's club. The radiant is projected through the same transform as the
 *     figure, so it stays put when the sky parallaxes.
 *   - Length is foreshortened by angular distance from the radiant. A meteor
 *     near the radiant is coming almost straight at you and appears as a stub;
 *     one 80° away shows its full path broadside. That factor is sin(D), and it
 *     is the single detail that makes a radiant read as a radiant.
 *   - Brightness is sampled from a real magnitude distribution using the
 *     shower's population index, so faint ones are common and a fireball is
 *     rare rather than every meteor being equally showy.
 *   - Colour is emission chemistry, mixed per meteor rather than picked from a
 *     list of four. Every meteoroid gets an entry speed and a randomised
 *     composition, and each spectral line lights up in proportion to how well
 *     that speed excites it — so a slow iron-and-sodium rock burns gold, and a
 *     66 km/s fragment of Halley burns violet-green. Head and wake are mixed
 *     separately because they are different things: the head is shock-heated
 *     plasma, the wake is cooling metal vapour behind it.
 *   - The trail is a flame, not a line. It wanders off the ballistic path,
 *     tapers, and flickers as the grain tumbles and fragments; bright ones shed
 *     ablation sparks and often end in a terminal flare.
 *   - Only the brightest leave a persistent train, which glows in the forbidden
 *     oxygen green of the upper atmosphere and shears as it fades — that shear
 *     is high-altitude wind dragging the ionised column apart.
 *
 * The one thing deliberately unfaithful is the rate. A ZHR of 20 is one meteor
 * every three minutes; nobody is staying on a landing page for that.
 */

/** Each magnitude step fainter is this many times more common. Orionids ≈ 3. */
const METEOR_POPULATION_INDEX = 200;
/**
 * The magnitude window we actually draw. The population index above is the real
 * one and does the real work — this is just where the window sits, and it is
 * clipped for the same reason the rate is. Sampling the true naked-eye range
 * puts two thirds of meteors at magnitude 3–5, which at hero scale is a streak
 * you cannot see, and pushes a train-leaving fireball to one in three hundred.
 * Narrowing the window keeps the distribution's shape and moves it somewhere
 * a person watching for thirty seconds will actually observe it.
 */
const METEOR_MAG_BRIGHTEST = -3.6;
const METEOR_MAG_FAINTEST = 1.2;

/** Angular distance from the radiant, in degrees, that meteors may appear at. */
const METEOR_MIN_ANGLE = 7;
const METEOR_MAX_ANGLE = 82;

/**
 * Atmospheric entry speed, km/s. The floor is Earth's escape velocity and the
 * ceiling is escape velocity plus Earth's orbital speed — nothing bound to the
 * solar system arrives outside that. Orionids are Halley debris met head-on and
 * sit near the top, which is why they burn as hot as they do.
 */
const SPEED_MIN = 11;
const SPEED_MAX = 72;
const ORIONID_SPEED = 66;

/** Path length per ms at the reference speed; scaled by each meteor's own. */
const METEOR_SPEED_PX_PER_MS = 1.5;
const METEOR_FIRST_MS = 500;
const METEOR_GAP_MIN_MS = 700;
const METEOR_GAP_MAX_MS = 900;

/** Roughly the real sporadic background — meteors owing nothing to the shower. */
const SPORADIC_FRACTION = 0.18;

/** Above this brightness a meteor is a fireball and leaves a train. */
const TRAIN_THRESHOLD = 0.62;
const TRAIN_FADE_MS = 1500;

/** Samples along the burning column: enough for the wobble to read as curved. */
const TRAIL_SEGMENTS = 18;

/**
 * One line of a meteor spectrum. `peak` and `spread` are where in the entry-speed
 * range the line is best excited — a crude stand-in for a Boltzmann factor, but
 * it puts each line where observation actually finds it.
 */
type EmissionLine = {
  label: string;
  rgb: [number, number, number];
  /** Abundance before excitation is taken into account. */
  base: number;
  /** Normalised entry speed the line peaks at, and how tolerant it is. */
  peak: number;
  spread: number;
  /** Ablated metal trails behind the head; shock and forbidden lines sit in it. */
  zone: "plasma" | "wake";
};

const EMISSION_LINES: EmissionLine[] = [
  // Sodium is volatile and largely baked out of fast Halley-family debris long
  // before it reaches us, so the orange really only shows on slow sporadics.
  // That is what the low peak encodes — it isn't a stylistic choice.
  { label: "Na I 589", rgb: [255, 176, 78], base: 1.0, peak: 0.1, spread: 0.26, zone: "wake" },
  { label: "Fe I 526–537", rgb: [255, 222, 148], base: 1.0, peak: 0.4, spread: 0.28, zone: "wake" },
  { label: "Mg I 518", rgb: [152, 255, 206], base: 0.95, peak: 0.58, spread: 0.24, zone: "plasma" },
  // Forbidden atmospheric oxygen — the auroral line, and what a persistent
  // train is made of.
  { label: "O I 557.7", rgb: [126, 255, 176], base: 0.78, peak: 0.82, spread: 0.2, zone: "plasma" },
  { label: "Ca II H&K", rgb: [178, 148, 255], base: 0.72, peak: 0.93, spread: 0.17, zone: "plasma" },
  // Shocked air rather than the meteoroid: only the fastest entries drive it.
  { label: "N₂ 1P", rgb: [255, 118, 92], base: 0.6, peak: 0.99, spread: 0.14, zone: "plasma" },
];

const OXYGEN_GREEN = EMISSION_LINES[3].rgb;

type MeteorColour = {
  /** Shock-heated plasma at the head. */
  hot: [number, number, number];
  /** Cooling metal vapour in the wake. */
  cool: [number, number, number];
  /** Forbidden-oxygen glow of a persistent train. */
  train: [number, number, number];
};

/**
 * Mixes one meteor's colours from the line list. The randomised abundance is
 * the reason no two are alike: real meteoroids are individual rocks, and the
 * spread of their spectra is wider than the spread of their speeds.
 */
function mixEmission(heat: number): MeteorColour {
  // The exponent is contrast. A real spectrum is dominated by one or two lines;
  // averaging six of them evenly just produces grey, and grey is the one colour
  // no meteor is. The random factor is compositional scatter — individual rocks
  // vary more than their speeds do, which is why no two of these look alike.
  const weights = EMISSION_LINES.map((line) => {
    const excitation = Math.exp(-((heat - line.peak) ** 2) / (2 * line.spread ** 2));
    return Math.pow(line.base * excitation * (0.3 + Math.random() * 1.4), 2.1);
  });

  // Then one line takes over. Meteor spectra are classified by their dominant
  // emitter — Na-type, Mg-type, Fe-type — not by an even blend, and the even
  // blend is also what ruins this visually: above about 60 km/s the green,
  // violet and red lines are all lit at once and average out to grey. Choosing
  // a leader, weighted by what the speed can actually excite, gives each meteor
  // one colour it is recognisably burning in.
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = Math.random() * totalWeight;
  let dominant = weights.length - 1;
  for (let i = 0; i < weights.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) {
      dominant = i;
      break;
    }
  }
  for (let i = 0; i < weights.length; i += 1) weights[i] *= i === dominant ? 9 : 0.5;

  // Both zones see every line — the head is dominated by whatever the shock is
  // exciting, the wake by whatever the grain is boiling off. The weights stay
  // absolute rather than being renormalised per zone, so a slow meteoroid whose
  // plasma lines are barely excited still gets a sodium-gold head instead of
  // whichever cold plasma line happened to be least faint.
  const blend = (plasmaBias: number, wakeBias: number): [number, number, number] => {
    let r = 0;
    let g = 0;
    let b = 0;
    let total = 0;
    EMISSION_LINES.forEach((line, index) => {
      const weight = weights[index] * (line.zone === "plasma" ? plasmaBias : wakeBias);
      r += line.rgb[0] * weight;
      g += line.rgb[1] * weight;
      b += line.rgb[2] * weight;
      total += weight;
    });
    if (total === 0) return [255, 255, 255];
    return [Math.round(r / total), Math.round(g / total), Math.round(b / total)];
  };

  const plasma = blend(3, 1);
  const cool = blend(0.35, 3);
  // The head also runs a continuum on top of the lines. Kept light — the core
  // pass over the trail supplies the white-hot centre, and doing it here as
  // well only bleaches the hue back out.
  const whiten = 0.16 + heat * 0.16;
  const hot: [number, number, number] = [
    Math.round(plasma[0] + (255 - plasma[0]) * whiten),
    Math.round(plasma[1] + (255 - plasma[1]) * whiten),
    Math.round(plasma[2] + (255 - plasma[2]) * whiten),
  ];
  const train: [number, number, number] = [
    Math.round(OXYGEN_GREEN[0] * 0.72 + cool[0] * 0.28),
    Math.round(OXYGEN_GREEN[1] * 0.72 + cool[1] * 0.28),
    Math.round(OXYGEN_GREEN[2] * 0.72 + cool[2] * 0.28),
  ];
  return { hot, cool, train };
}

/** A fragment shed off the head, burning out on its own. */
type Spark = {
  /** Fraction of the flight at which it lets go. */
  releaseAt: number;
  /** px/ms sideways, and relative to the head along the path. */
  lateral: number;
  along: number;
  life: number;
  size: number;
};

type Meteor = {
  x: number;
  y: number;
  dx: number;
  dy: number;
  length: number;
  duration: number;
  bornAt: number;
  brightness: number;
  colour: MeteorColour;
  train: boolean;
  /** Tumble and fragmentation, which is what makes a real trail shimmer. */
  flickerRate: number;
  flickerDepth: number;
  /** Per-meteor phase, so no two flames wobble in step. */
  seed: number;
  /** How far the burning column wanders off the ballistic line, in px. */
  wobble: number;
  /** Fraction of the flight a fireball's terminal flare happens at; 0 for none. */
  burstAt: number;
  sparks: Spark[];
  /** Head glow, tinted to this meteor's own plasma colour. */
  head: HTMLCanvasElement;
};

/**
 * Draws a magnitude from the shower's population distribution. The number of
 * meteors brighter than magnitude m goes as r^m, so inverting that CDF gives
 * the right mix: mostly faint, occasionally something worth looking up for.
 */
function sampleMeteorMagnitude(): number {
  const r = METEOR_POPULATION_INDEX;
  const low = Math.pow(r, METEOR_MAG_BRIGHTEST);
  const high = Math.pow(r, METEOR_MAG_FAINTEST);
  return Math.log(low + Math.random() * (high - low)) / Math.log(r);
}

/**
 * Angular distance from the radiant, distributed by solid angle. Uniform in D
 * would crowd meteors around the radiant, because a ring at distance D has
 * circumference proportional to sin(D).
 */
function sampleRadiantAngle(): number {
  const min = (METEOR_MIN_ANGLE * Math.PI) / 180;
  const max = (METEOR_MAX_ANGLE * Math.PI) / 180;
  const cosine = Math.cos(min) - Math.random() * (Math.cos(min) - Math.cos(max));
  return Math.acos(cosine);
}

type TrailPoint = { x: number; y: number; t: number };

/**
 * Samples the burning column. The path is the ballistic line with a slow
 * sinuous offset that grows toward the tail: the head is the solid grain and
 * goes where it is pointed, while everything behind it is turbulent vapour
 * being pulled about. A perfectly straight trail reads as a scratch on the lens.
 */
function trailPath(
  meteor: Meteor,
  headDistance: number,
  trailLength: number,
  age: number,
): TrailPoint[] {
  const nx = -meteor.dy;
  const ny = meteor.dx;
  const points: TrailPoint[] = [];
  for (let i = 0; i <= TRAIL_SEGMENTS; i += 1) {
    const t = i / TRAIL_SEGMENTS;
    const distance = headDistance - trailLength * t;
    const drift =
      (Math.sin(t * 5.5 + meteor.seed + age * 0.004) +
        Math.sin(t * 13 + meteor.seed * 2.3) * 0.35) *
      meteor.wobble *
      t;
    points.push({
      x: meteor.x + meteor.dx * distance + nx * drift,
      y: meteor.y + meteor.dy * distance + ny * drift,
      t,
    });
  }
  return points;
}

const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/**
 * Pre-renders one soft radial glow per tone. Blitting these with `drawImage`
 * is several times cheaper than building a gradient per star per frame, which
 * is what makes the star count affordable at all.
 *
 * `gain` scales the whole falloff. The figure burns hotter than the field: the
 * constellation is the subject and the field is depth behind it, and lifting
 * both together just raises the noise floor until the sky reads as fog.
 */
function buildSprite(
  rgb: [number, number, number],
  size: number,
  gain = 1,
): HTMLCanvasElement {
  const sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;
  const ctx = sprite.getContext("2d");
  if (!ctx) return sprite;

  const centre = size / 2;
  const gradient = ctx.createRadialGradient(centre, centre, 0, centre, centre, centre);
  const [r, g, b] = rgb;
  const stop = (alpha: number) => Math.min(1, alpha * gain);
  // A tight white-hot core inside a wide, fast-falling halo — the falloff is
  // what reads as "star" rather than "dot with a blur on it".
  gradient.addColorStop(0, `rgba(255,255,255,${stop(0.95)})`);
  gradient.addColorStop(0.12, `rgba(${r},${g},${b},${stop(0.85)})`);
  gradient.addColorStop(0.28, `rgba(${r},${g},${b},${stop(0.32)})`);
  gradient.addColorStop(0.55, `rgba(${r},${g},${b},${stop(0.07)})`);
  gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return sprite;
}

/**
 * Pre-renders a four-point diffraction glint per tone — the cross a bright star
 * throws in any real optic, and the thing the eye actually reads as "shiny".
 *
 * It's a separate sprite rather than a brighter halo because sheer alpha on the
 * radial glow only ever produces a bigger, softer blob: past a point the halo
 * stops looking like light and starts looking like a smudge. The spikes carry
 * the extra brightness as structure instead, so the star gets sharper as it
 * gets brighter rather than woollier.
 *
 * Rays are tapered triangles filled with their own gradient, so the energy sits
 * near the core and the tips fade out rather than ending on a visible edge.
 */
function buildGlint(rgb: [number, number, number], size: number): HTMLCanvasElement {
  const sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;
  const ctx = sprite.getContext("2d");
  if (!ctx) return sprite;

  const centre = size / 2;
  const [r, g, b] = rgb;
  /** Half-width of a ray where it leaves the core. Thin: this is a spike. */
  const halfBase = size * 0.02;

  const ray = (dx: number, dy: number) => {
    const gradient = ctx.createLinearGradient(
      centre,
      centre,
      centre + dx * centre,
      centre + dy * centre,
    );
    gradient.addColorStop(0, `rgba(255,255,255,0.9)`);
    gradient.addColorStop(0.1, `rgba(${r},${g},${b},0.46)`);
    gradient.addColorStop(0.34, `rgba(${r},${g},${b},0.12)`);
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);

    // Perpendicular, for the base of the triangle.
    const px = -dy * halfBase;
    const py = dx * halfBase;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(centre + px, centre + py);
    ctx.lineTo(centre - px, centre - py);
    ctx.lineTo(centre + dx * centre, centre + dy * centre);
    ctx.closePath();
    ctx.fill();
  };

  ray(1, 0);
  ray(-1, 0);
  ray(0, 1);
  ray(0, -1);
  return sprite;
}

/**
 * Where the constellation sits inside the canvas, as fractions of it. The
 * field stars ignore this and always fill the whole canvas.
 */
export type FigureAnchor = {
  /** Centre of the figure. */
  cx: number;
  cy: number;
  /** How much of the canvas the figure may fill. */
  width: number;
  height: number;
};

const CENTRED: FigureAnchor = { cx: 0.5, cy: 0.5, width: 0.94, height: 0.9 };

type StarfieldProps = {
  className?: string;
  mouse?: MousePosition;
  figure?: FigureAnchor;
  /**
   * Draw the constellation — the figure's stars, its asterism, and the ignition
   * sequence that brings them up. The field stars and meteors are independent
   * of this and always render.
   */
  showConstellation?: boolean;
};

export function StarfieldCanvas({
  className,
  mouse,
  figure = CENTRED,
  showConstellation = true,
}: StarfieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduceMotion = usePrefersReducedMotion();
  // Read through a ref so a moving anchor doesn't tear down and restart the
  // whole scene — that would rebuild the sprites and replay the intro. The
  // same goes for the figure being switched off at a breakpoint.
  const figureRef = useRef(figure);
  const showConstellationRef = useRef(showConstellation);
  const redrawRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    // Take the amber straight off the live token so a rebrand reaches the sky.
    const tokenAmber = getComputedStyle(document.documentElement)
      .getPropertyValue("--orion-amber")
      .trim();
    const parsedAmber = /^#([0-9a-f]{6})$/i.exec(tokenAmber);
    if (parsedAmber) {
      const hex = parseInt(parsedAmber[1], 16);
      TONE_RGB.amber = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
    }

    const SPRITE_SIZE = 64;
    const sprites: Record<StarTone, HTMLCanvasElement> = {
      amber: buildSprite(TONE_RGB.amber, SPRITE_SIZE),
      blue: buildSprite(TONE_RGB.blue, SPRITE_SIZE),
      bone: buildSprite(TONE_RGB.bone, SPRITE_SIZE),
    };
    // The figure's own, hotter set. Same geometry, so nothing about the layout
    // or the ignition timing changes — only how much light comes off it.
    const FIGURE_GAIN = 1.55;
    const figureSprites: Record<StarTone, HTMLCanvasElement> = {
      amber: buildSprite(TONE_RGB.amber, SPRITE_SIZE, FIGURE_GAIN),
      blue: buildSprite(TONE_RGB.blue, SPRITE_SIZE, FIGURE_GAIN),
      bone: buildSprite(TONE_RGB.bone, SPRITE_SIZE, FIGURE_GAIN),
    };
    const GLINT_SIZE = 128;
    const glints: Record<StarTone, HTMLCanvasElement> = {
      amber: buildGlint(TONE_RGB.amber, GLINT_SIZE),
      blue: buildGlint(TONE_RGB.blue, GLINT_SIZE),
      bone: buildGlint(TONE_RGB.bone, GLINT_SIZE),
    };
    // Meteor heads can't share a sprite set the way stars do — every meteor
    // mixes its own colour — so each builds one at spawn and drops it when it
    // dies. That's one small canvas a second, against a gradient per frame.
    const METEOR_SPRITE_SIZE = 96;

    let width = 0;
    let height = 0;
    /** px per normalised unit, for the constellation and for the field stars. */
    let figureScale = 1;
    let fieldScale = 1;
    let fieldStars: FieldStar[] = [];
    let frameId = 0;
    let running = false;
    let startTime = 0;
    /** Accumulated animation time, so pausing doesn't fast-forward the sky. */
    let elapsed = 0;

    let yaw = 0;
    let pitch = 0;
    let targetYaw = 0;
    let targetPitch = 0;
    let scrollOffset = 0;

    let meteors: Meteor[] = [];
    let nextMeteorAt = METEOR_FIRST_MS;

    // The constellation lives on a near-flat plane. Real distances (Rigel
    // ~860ly, Alnilam ~2000ly) would tear the figure apart the moment the
    // camera moved, and an unrecognisable Orion defeats the point.
    const constellation: ConstellationStar[] = PROJECTED_ORION.map((star, index) => {
      const brightness = magnitudeToBrightness(star.mag);
      return {
        x: star.x / ORION_RADIUS_DEGREES,
        y: star.y / ORION_RADIUS_DEGREES,
        z: (index % 3) * 0.018 - 0.018,
        radius: 3.4 + brightness * 9,
        brightness,
        tone: star.tone,
        igniteAt: 0,
        twinklePhase: Math.random() * Math.PI * 2,
        twinkleRate: 0.0006 + Math.random() * 0.0005,
      };
    });

    // Ignite brightest first — it reads as the sky resolving, rather than a
    // list animating in.
    constellation
      .map((star, index) => ({ index, brightness: star.brightness }))
      .sort((a, b) => b.brightness - a.brightness)
      .forEach((entry, order) => {
        constellation[entry.index].igniteAt = IGNITE_START_MS + order * IGNITE_STAGGER_MS;
      });

    function buildFieldStars() {
      const count = Math.round(
        Math.min(MAX_FIELD_STARS, Math.max(MIN_FIELD_STARS, width * height * FIELD_STAR_DENSITY)),
      );
      fieldStars = Array.from({ length: count }, () => {
        const depth = Math.random();
        // Bias faint and small; a field of uniformly bright dots looks like
        // noise, not distance.
        const brightness = Math.pow(Math.random(), 1.9) * 0.95 + 0.08;
        const roll = Math.random();
        return {
          x: (Math.random() - 0.5) * 2 * FIELD_SPREAD_X,
          y: (Math.random() - 0.5) * 2 * FIELD_SPREAD_Y,
          z: -0.35 + depth * 2.6,
          radius: 0.7 + Math.pow(Math.random(), 2) * 2.6,
          brightness,
          tone: roll > 0.965 ? "amber" : roll > 0.78 ? "blue" : "bone",
          twinklePhase: Math.random() * Math.PI * 2,
          twinkleRate: 0.0004 + Math.random() * 0.0016,
          appearAt: Math.random() * 900,
        };
      });
    }

    function resize() {
      width = parent!.clientWidth;
      height = parent!.clientHeight;
      if (width === 0 || height === 0) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Field stars get their own scale, derived from the canvas rather than
      // from the figure, so the sky always reaches every edge.
      fieldScale =
        Math.max(width / (2 * FIELD_SPREAD_X), height / (2 * FIELD_SPREAD_Y)) * FIELD_OVERSCAN;

      if (fieldStars.length === 0) buildFieldStars();
    }

    function draw(time: number) {
      ctx!.clearRect(0, 0, width, height);
      ctx!.globalCompositeOperation = "lighter";

      const dollyProgress = easeOutExpo(clamp01(time / DOLLY_MS));
      const focal = FOCAL_START + (FOCAL - FOCAL_START) * dollyProgress;

      const anchor = figureRef.current;
      const drift = scrollOffset * 0.1;

      // Two centres: the field fills the canvas, the figure sits wherever the
      // layout put it.
      const fieldX = width / 2;
      const fieldY = height / 2 - drift;
      const figureX = width * anchor.cx;
      const figureY = height * anchor.cy - drift;

      // Fit the figure to whichever axis of its anchor runs out first. Fitting
      // the shorter axis was fine when Orion was roughly square, but with the
      // club reaching to +20° declination and the shield out to 4h50m RA the
      // figure is half again as tall as it is wide, and that rule cut the club
      // off. Computed per frame rather than on resize because the anchor is
      // measured from the DOM and can move without the canvas changing size.
      figureScale = Math.min(
        (width * anchor.width) / (2 * ORION_HALF_WIDTH),
        (height * anchor.height) / (2 * ORION_HALF_HEIGHT),
      );

      const cosYaw = Math.cos(yaw);
      const sinYaw = Math.sin(yaw);
      const cosPitch = Math.cos(pitch);
      const sinPitch = Math.sin(pitch);

      const project = (
        x: number,
        y: number,
        z: number,
        centreX: number,
        centreY: number,
        scale: number,
      ) => {
        // Yaw about Y, then pitch about X. Angles stay tiny, so the figure
        // parallaxes without ever looking like it's tumbling.
        const rx = x * cosYaw + z * sinYaw;
        const rz1 = -x * sinYaw + z * cosYaw;
        const ry = y * cosPitch - rz1 * sinPitch;
        const rz = y * sinPitch + rz1 * cosPitch;
        const perspective = focal / (focal + rz);
        return {
          sx: centreX + rx * perspective * scale,
          sy: centreY + ry * perspective * scale,
          perspective,
        };
      };

      const projectField = (x: number, y: number, z: number) =>
        project(x, y, z, fieldX, fieldY, fieldScale);
      const projectFigure = (x: number, y: number, z: number) =>
        project(x, y, z, figureX, figureY, figureScale);

      // ---- Field stars ----
      for (const star of fieldStars) {
        const appear = clamp01((time - star.appearAt) / 700);
        if (appear <= 0) continue;

        const { sx, sy, perspective } = projectField(star.x, star.y, star.z);
        if (sx < -60 || sx > width + 60 || sy < -60 || sy > height + 60) continue;

        const twinkle = 0.78 + 0.22 * Math.sin(time * star.twinkleRate + star.twinklePhase);
        const alpha = star.brightness * twinkle * appear * perspective;
        if (alpha <= 0.004) continue;

        const size = star.radius * perspective * 7;
        ctx!.globalAlpha = Math.min(1, alpha);
        ctx!.drawImage(sprites[star.tone], sx - size / 2, sy - size / 2, size, size);
      }

      // ---- Asterism ----
      // Drawn under the constellation stars so the joints sit behind the glow.
      const drawFigure = showConstellationRef.current;
      for (let i = 0; drawFigure && i < ORION_EDGES.length; i += 1) {
        const [fromIndex, toIndex] = ORION_EDGES[i];
        const progress = clamp01((time - (EDGE_START_MS + i * EDGE_STAGGER_MS)) / EDGE_DRAW_MS);
        if (progress <= 0) continue;

        const from = constellation[fromIndex];
        const to = constellation[toIndex];
        const a = projectFigure(from.x, from.y, from.z);
        const b = projectFigure(to.x, to.y, to.z);
        const eased = easeOutCubic(progress);

        // A flat stroke rather than a per-edge gradient: at these opacities the
        // taper is invisible, and building 12 gradients every frame was pure
        // allocation churn.
        //
        // Two passes, both of the same line. The wide one is a bloom at an alpha
        // low enough that it never reads as an edge of its own — under `lighter`
        // it sums into the halo around the 1px core and the line reads as
        // *emitting* rather than as being drawn. Widening the core instead would
        // make the asterism heavier, which is the one thing it must not be: the
        // lines are an annotation over the stars, not a wireframe of them.
        ctx!.globalAlpha = 1;
        ctx!.beginPath();
        ctx!.moveTo(a.sx, a.sy);
        ctx!.lineTo(a.sx + (b.sx - a.sx) * eased, a.sy + (b.sy - a.sy) * eased);
        ctx!.strokeStyle = "rgba(214,230,255,0.05)";
        ctx!.lineWidth = 3.5;
        ctx!.stroke();
        // Cooled very slightly toward the blue the figure is actually made of,
        // which at this alpha reads as starlight rather than as a grey rule.
        ctx!.strokeStyle = "rgba(226,238,255,0.42)";
        ctx!.lineWidth = 1;
        ctx!.stroke();
      }

      // ---- Constellation ----
      for (const star of drawFigure ? constellation : []) {
        const ignite = clamp01((time - star.igniteAt) / IGNITE_MS);
        if (ignite <= 0) continue;

        const { sx, sy, perspective } = projectFigure(star.x, star.y, star.z);
        const eased = easeOutCubic(ignite);
        // Overshoot on ignition, so each star flares and settles instead of
        // simply fading up.
        const flare = 1 + 0.85 * Math.sin(Math.PI * Math.min(1, ignite * 1.4)) * (1 - ignite * 0.4);
        const twinkle = 0.9 + 0.1 * Math.sin(time * star.twinkleRate + star.twinklePhase);

        const alpha = Math.min(1, star.brightness * eased * twinkle);
        const size = star.radius * perspective * flare * 6.5;
        const sprite = figureSprites[star.tone];

        ctx!.globalAlpha = alpha;
        ctx!.drawImage(sprite, sx - size / 2, sy - size / 2, size, size);

        // A second, tighter pass gives the bright stars a hard core the wide
        // halo can't produce on its own. The threshold used to sit at 0.45,
        // which is above every star in the club and most of the shield — so the
        // parts of the figure that were already faintest were also the only
        // ones drawn without a core. Dropped so the whole figure gets one, with
        // the faint stars weighting theirs down by brightness rather than
        // losing it outright.
        if (star.brightness > 0.18) {
          const coreSize = size * 0.26;
          ctx!.globalAlpha = Math.min(1, alpha * (0.85 + star.brightness * 0.5));
          ctx!.drawImage(sprite, sx - coreSize / 2, sy - coreSize / 2, coreSize, coreSize);
        }

        // The glint. Scaled by brightness so it separates the belt and the
        // shoulders from the sword the way magnitude does in the sky, and
        // driven by its own slower beat than the halo's twinkle — a real star
        // scintillates in the spikes long before the disc visibly changes.
        if (star.brightness > 0.24) {
          const shimmer =
            0.74 + 0.26 * Math.sin(time * star.twinkleRate * 0.63 + star.twinklePhase * 1.7);
          const glintSize = size * (0.9 + star.brightness * 0.55);
          ctx!.globalAlpha = Math.min(1, alpha * star.brightness * shimmer * eased * 0.85);
          ctx!.drawImage(
            glints[star.tone],
            sx - glintSize / 2,
            sy - glintSize / 2,
            glintSize,
            glintSize,
          );
        }
      }

      // ---- Meteors ----
      // Drawn last so a fireball passes in front of the figure, which is what
      // happens: the constellation is light-years away, the meteor is 90km up.
      if (!reduceMotion) {
        if (time >= nextMeteorAt) {
          meteors.push(spawnMeteor(time, projectFigure));
          nextMeteorAt =
            time + METEOR_GAP_MIN_MS + Math.random() * (METEOR_GAP_MAX_MS - METEOR_GAP_MIN_MS);
        }

        meteors = meteors.filter((meteor) => {
          const age = time - meteor.bornAt;
          const life = meteor.duration + (meteor.train ? TRAIN_FADE_MS : 0);
          if (age > life) return false;
          drawMeteor(meteor, age);
          return true;
        });
      }

      ctx!.globalAlpha = 1;
      ctx!.globalCompositeOperation = "source-over";
    }

    function spawnMeteor(
      time: number,
      projectFigure: (x: number, y: number, z: number) => { sx: number; sy: number },
    ): Meteor {
      const magnitude = sampleMeteorMagnitude();
      // Floored at 0.28 so even the faintest is a streak rather than a rumour.
      const brightness =
        0.28 +
        0.72 *
          clamp01(
            (METEOR_MAG_FAINTEST - magnitude) / (METEOR_MAG_FAINTEST - METEOR_MAG_BRIGHTEST),
          );

      const diagonal = Math.hypot(width, height);
      const bearing = Math.random() * Math.PI * 2;
      const dx = Math.cos(bearing);
      const dy = Math.sin(bearing);

      const sporadic = Math.random() < SPORADIC_FRACTION;
      let originX: number;
      let originY: number;
      let length: number;
      let speed: number;

      if (sporadic) {
        // A sporadic owes nothing to the shower: no radiant, so no
        // foreshortening rule to obey, no preferred direction, and no shared
        // orbit fixing its speed.
        originX = Math.random() * width;
        originY = Math.random() * height * 0.75;
        length = diagonal * (0.18 + Math.random() * 0.24);
        speed = SPEED_MIN + Math.pow(Math.random(), 1.3) * (SPEED_MAX - SPEED_MIN);
      } else {
        const radiant = projectFigure(ORIONID_RADIANT.x, ORIONID_RADIANT.y, 0);
        const angle = sampleRadiantAngle();
        // Map the sky angle onto the canvas so the outer limit reaches a corner.
        const pixelsPerRadian = diagonal / ((METEOR_MAX_ANGLE * Math.PI) / 180);
        const offset = angle * pixelsPerRadian;
        originX = radiant.sx + dx * offset;
        originY = radiant.sy + dy * offset;
        // Foreshortening. This is the whole trick.
        length = diagonal * 0.44 * Math.sin(angle);
        // Everything in the stream is on the same orbit, so they all arrive at
        // very nearly the same speed. That is why a shower has a house colour.
        speed = ORIONID_SPEED + (Math.random() - 0.5) * 3;
      }

      const heat = clamp01((speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN));
      const colour = mixEmission(heat);
      const finalBrightness = sporadic ? brightness * 0.85 : brightness;

      // Fireballs usually break up rather than simply burning out, and the
      // flare when they do is the part people remember.
      const burstAt = finalBrightness > 0.68 && Math.random() < 0.75
        ? 0.5 + Math.random() * 0.32
        : 0;

      const sparkCount = Math.round(finalBrightness * 16 * (0.4 + heat * 0.9));
      const sparks: Spark[] = Array.from({ length: sparkCount }, () => ({
        releaseAt: 0.1 + Math.random() * 0.75,
        lateral: (Math.random() - 0.5) * 0.09,
        along: -Math.random() * 0.16,
        life: 180 + Math.random() * 420,
        size: 0.6 + Math.random() * 1.5,
      }));

      return {
        x: originX,
        y: originY,
        dx,
        dy,
        length,
        // Faster meteors cover their path in less time — the streak is the same
        // length, it just doesn't hang about.
        duration: Math.max(200, length / (METEOR_SPEED_PX_PER_MS * (0.55 + heat * 0.8))),
        bornAt: time,
        brightness: finalBrightness,
        colour,
        train: !sporadic && brightness > TRAIN_THRESHOLD,
        // Small grains tumble faster and shed more violently, so the faint ones
        // shimmer hardest while a fireball burns comparatively steadily.
        flickerRate: 0.05 + Math.random() * 0.09,
        flickerDepth: 0.16 + (1 - finalBrightness) * 0.3,
        seed: Math.random() * Math.PI * 2,
        wobble: (1.5 + Math.random() * 3.5) * (0.6 + finalBrightness),
        burstAt,
        sparks,
        head: buildSprite(colour.hot, METEOR_SPRITE_SIZE),
      };
    }

    /** Runs a sampled trail as one polyline. */
    function strokeTrail(points: TrailPoint[], style: CanvasGradient, lineWidth: number, alpha: number) {
      ctx!.globalAlpha = alpha;
      ctx!.strokeStyle = style;
      ctx!.lineWidth = lineWidth;
      ctx!.lineCap = "round";
      ctx!.lineJoin = "round";
      ctx!.beginPath();
      ctx!.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i += 1) ctx!.lineTo(points[i].x, points[i].y);
      ctx!.stroke();
    }

    /**
     * Colours a trail from the head backwards, tapering to nothing and
     * flickering along its length. A meteor cannot be drawn as a straight
     * alpha ramp: the column is being fed in pulses as the grain tumbles and
     * sheds, and it is that unevenness the eye reads as burning.
     */
    function flameGradient(
      meteor: Meteor,
      points: TrailPoint[],
      from: [number, number, number],
      to: [number, number, number],
      peakAlpha: number,
      age: number,
    ): CanvasGradient {
      const head = points[0];
      const tail = points[points.length - 1];
      const gradient = ctx!.createLinearGradient(head.x, head.y, tail.x, tail.y);
      for (let i = 0; i <= TRAIL_SEGMENTS; i += 1) {
        const t = i / TRAIL_SEGMENTS;
        const taper = Math.pow(1 - t, 1.35);
        const flicker =
          1 +
          meteor.flickerDepth *
            (Math.sin(t * 11 - age * meteor.flickerRate + meteor.seed) * 0.6 +
              Math.sin(t * 27 - age * meteor.flickerRate * 1.7 + meteor.seed * 3.1) * 0.4);
        const r = Math.round(from[0] + (to[0] - from[0]) * t);
        const g = Math.round(from[1] + (to[1] - from[1]) * t);
        const b = Math.round(from[2] + (to[2] - from[2]) * t);
        gradient.addColorStop(t, `rgba(${r},${g},${b},${clamp01(peakAlpha * taper * flicker)})`);
      }
      return gradient;
    }

    function drawMeteor(meteor: Meteor, age: number) {
      const { hot, cool, train: trainRgb } = meteor.colour;
      const progress = clamp01(age / meteor.duration);

      // Persistent train: the ionised path hangs after the meteor is gone,
      // glowing in forbidden oxygen, and shears sideways in high-altitude winds.
      if (meteor.train && age > meteor.duration * 0.3) {
        const fade = clamp01(1 - (age - meteor.duration * 0.3) / TRAIN_FADE_MS);
        if (fade > 0) {
          const shear = (1 - fade) * 9;
          const [r, g, b] = trainRgb;
          const points = trailPath(meteor, meteor.length, meteor.length * 0.92, age);
          // Shear grows toward the tail: the oldest part of the column has had
          // the longest to be dragged off the path.
          for (const point of points) {
            point.x += -meteor.dy * shear * point.t;
            point.y += meteor.dx * shear * point.t;
          }
          const decay = fade * fade;
          ctx!.globalAlpha = 1;
          ctx!.strokeStyle = `rgba(${r},${g},${b},${0.09 * decay})`;
          ctx!.lineWidth = 5 * (1 + (1 - fade) * 1.6);
          ctx!.lineCap = "round";
          ctx!.lineJoin = "round";
          ctx!.beginPath();
          ctx!.moveTo(points[0].x, points[0].y);
          for (let i = 1; i < points.length; i += 1) ctx!.lineTo(points[i].x, points[i].y);
          ctx!.stroke();
          ctx!.strokeStyle = `rgba(${r},${g},${b},${0.16 * decay})`;
          ctx!.lineWidth = 1.5;
          ctx!.stroke();
          ctx!.lineCap = "butt";
        }
      }

      if (progress >= 1) return;

      // Meteors brighten as they descend into thicker air, then extinguish —
      // the rise is much quicker than the fall.
      const intensity = clamp01(progress / 0.12) * clamp01((1 - progress) / 0.34);
      // The terminal flare, if this one is breaking up.
      const burst =
        meteor.burstAt > 0
          ? 1 + 1.7 * Math.exp(-((progress - meteor.burstAt) ** 2) / 0.0022)
          : 1;
      const alpha = clamp01(meteor.brightness * intensity * burst);
      if (alpha <= 0.01) return;

      const headDistance = progress * meteor.length;
      // The column grows behind the head rather than being full length from the
      // first frame, and it can't reach back past where the meteor started.
      const trailLength = Math.min(headDistance, meteor.length * 0.62);
      const points = trailPath(meteor, headDistance, trailLength, age);
      const headX = points[0].x;
      const headY = points[0].y;

      // Three passes: a wide, dim envelope of glowing air; the body of the
      // flame; and a hard incandescent core. Under `lighter` they sum into a
      // column that is white at the centre and coloured at the edges, which is
      // what a bright meteor actually looks like.
      const coreWidth = 1.2 + meteor.brightness * 3.6 + (burst - 1) * 1.4;
      const white: [number, number, number] = [
        Math.round(hot[0] * 0.25 + 255 * 0.75),
        Math.round(hot[1] * 0.25 + 255 * 0.75),
        Math.round(hot[2] * 0.25 + 255 * 0.75),
      ];

      strokeTrail(
        points,
        flameGradient(meteor, points, hot, cool, alpha * 0.5, age),
        coreWidth * 5.5,
        0.26,
      );
      strokeTrail(
        points,
        flameGradient(meteor, points, hot, cool, alpha * 0.8, age),
        coreWidth * 2.3,
        0.5,
      );
      strokeTrail(points, flameGradient(meteor, points, white, hot, alpha, age), coreWidth, 1);

      // Round caps are wrong for the 1px asterism strokes on the next frame.
      ctx!.lineCap = "butt";
      ctx!.lineJoin = "miter";

      // ---- Ablation sparks ----
      // Fragments that let go of the head and burn out on their own, drifting
      // back and sideways. Only bright meteors carry enough of them to notice.
      if (meteor.sparks.length > 0) {
        const nx = -meteor.dy;
        const ny = meteor.dx;
        ctx!.fillStyle = `rgb(${cool[0]},${cool[1]},${cool[2]})`;
        for (const spark of meteor.sparks) {
          const life = age - spark.releaseAt * meteor.duration;
          if (life < 0 || life > spark.life) continue;
          const decay = 1 - life / spark.life;
          const released = spark.releaseAt * meteor.length;
          const sx =
            meteor.x + meteor.dx * (released + spark.along * life) + nx * spark.lateral * life;
          const sy =
            meteor.y + meteor.dy * (released + spark.along * life) + ny * spark.lateral * life;
          ctx!.globalAlpha = clamp01(alpha * decay * decay * 0.9);
          ctx!.beginPath();
          ctx!.arc(sx, sy, spark.size * decay, 0, Math.PI * 2);
          ctx!.fill();
        }
      }

      // ---- Head ----
      // A wide halo with a tight core inside it, same trick as the bright stars.
      const headSize = (14 + meteor.brightness * 52) * (0.55 + intensity * 0.45) * Math.min(burst, 2.2);
      ctx!.globalAlpha = Math.min(1, alpha * 1.15);
      ctx!.drawImage(meteor.head, headX - headSize / 2, headY - headSize / 2, headSize, headSize);
      const coreSize = headSize * 0.34;
      ctx!.globalAlpha = Math.min(1, alpha * 1.3);
      ctx!.drawImage(meteor.head, headX - coreSize / 2, headY - coreSize / 2, coreSize, coreSize);
    }

    function tick(now: number) {
      if (!running) return;
      if (startTime === 0) startTime = now;
      elapsed = now - startTime;

      if (mouse) {
        // Tiny angles. The sky should feel like it has depth, not like it's
        // mounted on a gimbal.
        targetYaw = (mouse.x.get() - 0.5) * 0.26;
        targetPitch = (mouse.y.get() - 0.5) * 0.18;
      }
      yaw += (targetYaw - yaw) * 0.045;
      pitch += (targetPitch - pitch) * 0.045;

      draw(elapsed);
      frameId = requestAnimationFrame(tick);
    }

    function start() {
      if (running) return;
      running = true;
      // Resume where we left off rather than jumping the intro forward.
      startTime = performance.now() - elapsed;
      frameId = requestAnimationFrame(tick);
    }

    function stop() {
      running = false;
      cancelAnimationFrame(frameId);
    }

    resize();

    if (reduceMotion) {
      // One settled frame. Still a sky — just not a moving one.
      const settled = () => draw(SKY_END_MS + 4000);
      settled();
      redrawRef.current = settled;
      const staticObserver = new ResizeObserver(() => {
        resize();
        settled();
      });
      staticObserver.observe(parent);
      return () => {
        redrawRef.current = null;
        staticObserver.disconnect();
      };
    }

    start();

    const resizeObserver = new ResizeObserver(() => {
      resize();
      if (!running) draw(elapsed);
    });
    resizeObserver.observe(parent);

    // Don't burn frames on a hero that's scrolled away or a backgrounded tab.
    const intersectionObserver = new IntersectionObserver(
      ([entry]) => (entry.isIntersecting ? start() : stop()),
      { threshold: 0 },
    );
    intersectionObserver.observe(parent);

    const handleVisibility = () => {
      if (document.hidden) stop();
      else if (parent.getBoundingClientRect().bottom > 0) start();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    const handleScroll = () => {
      scrollOffset = window.scrollY;
    };
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      stop();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("scroll", handleScroll);
    };
  }, [reduceMotion, mouse]);

  // The anchor is measured after mount, and can change on a breakpoint without
  // the canvas itself resizing. The running loop picks up `figureRef` on its
  // next frame; a reduced-motion canvas has no next frame, so it gets poked.
  useEffect(() => {
    figureRef.current = figure;
    showConstellationRef.current = showConstellation;
    redrawRef.current?.();
  }, [figure, showConstellation]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn("pointer-events-none absolute inset-0", className)}
    />
  );
}
