/**
 * The Orion constellation, for the hero backdrop.
 *
 * These are the real stars at their real coordinates — J2000 right ascension
 * and declination, straight off the catalogues — projected onto a plane. The
 * shape you see in the hero is the shape in the sky. It costs nothing to be
 * accurate here and the asterism is recognisable enough that being sloppy
 * would show.
 */

export type CatalogStar = {
  /** Bayer designation, for the curious reading the source. */
  id: string;
  name: string;
  /** Right ascension, J2000, in hours. */
  ra: number;
  /** Declination, J2000, in degrees. */
  dec: number;
  /** Apparent visual magnitude. Lower is brighter. */
  mag: number;
  /**
   * Which palette the star draws in. Orion is mostly blue-white supergiants;
   * Betelgeuse is the famous red one, which is why it carries the brand amber
   * rather than us inventing a reason to put amber in the sky.
   */
  tone: "amber" | "blue" | "bone";
};

/**
 * The whole figure: shoulders, belt, knees, head, sword, the raised club and
 * the shield. Coordinates are sexagesimal converted to decimal — e.g.
 * Betelgeuse at 05h 55m 10.3s is 5 + 55/60 + 10.3/3600.
 *
 * Tone follows spectral class, not taste. Orion is overwhelmingly B-type blue
 * supergiants, which is why the field is so cold; the two warm stars are the
 * two that are genuinely warm — Betelgeuse (M1-2, the famous red one) and
 * π⁶ Ori (K0/1 III, an orange giant at the foot of the shield). Getting an
 * amber at each end of the figure is luck, not license.
 */
export const ORION_STARS: CatalogStar[] = [
  // Shoulders
  { id: "α Ori", name: "Betelgeuse", ra: 5.919529, dec: 7.407064, mag: 0.5, tone: "amber" },
  { id: "γ Ori", name: "Bellatrix", ra: 5.418851, dec: 6.349702, mag: 1.64, tone: "blue" },
  // Belt — Mintaka, Alnilam, Alnitak, west to east
  { id: "δ Ori", name: "Mintaka", ra: 5.533444, dec: -0.299095, mag: 2.23, tone: "blue" },
  { id: "ε Ori", name: "Alnilam", ra: 5.603558, dec: -1.201917, mag: 1.69, tone: "blue" },
  { id: "ζ Ori", name: "Alnitak", ra: 5.679313, dec: -1.942851, mag: 1.77, tone: "blue" },
  // Feet
  { id: "β Ori", name: "Rigel", ra: 5.242298, dec: -8.201639, mag: 0.13, tone: "blue" },
  { id: "κ Ori", name: "Saiph", ra: 5.795941, dec: -9.669605, mag: 2.06, tone: "blue" },
  // Head
  { id: "λ Ori", name: "Meissa", ra: 5.585631, dec: 9.934136, mag: 3.39, tone: "bone" },
  // Sword, hanging off the belt
  { id: "42 Ori", name: "42 Orionis", ra: 5.589722, dec: -4.833333, mag: 4.59, tone: "bone" },
  { id: "θ Ori", name: "Orion Nebula", ra: 5.588056, dec: -5.391111, mag: 4.0, tone: "bone" },
  { id: "ι Ori", name: "Hatysa", ra: 5.590556, dec: -5.909889, mag: 2.77, tone: "blue" },

  // The club, stretching north from Betelgeuse. μ is the elbow; ξ, ν, 69, χ²
  // and χ¹ close into the head of the club itself. These are the faintest
  // things in the figure — nothing here is brighter than mag 4.3 — which is
  // exactly why the arm is the first part of Orion people stop drawing.
  { id: "μ Ori", name: "Mu Orionis", ra: 6.039721, dec: 9.647289, mag: 4.3, tone: "bone" }, // A1 Vm
  { id: "ξ Ori", name: "Xi Orionis", ra: 6.20011, dec: 14.208765, mag: 4.47, tone: "blue" }, // B3 IV
  { id: "ν Ori", name: "Nu Orionis", ra: 6.126202, dec: 14.768474, mag: 4.42, tone: "blue" }, // B3 V
  { id: "χ² Ori", name: "Chi2 Orionis", ra: 6.065329, dec: 20.138452, mag: 4.63, tone: "blue" }, // B2 Ia
  { id: "χ¹ Ori", name: "Chi1 Orionis", ra: 5.906378, dec: 20.276256, mag: 4.39, tone: "bone" }, // G0 V

  // The shield (or bow) — six stars all bearing the Bayer letter π, arcing
  // down the western side in front of Bellatrix. They are not a physical
  // group and share nothing but a label: π³ is 26 light-years away, π⁴ is
  // about 1,050. π¹ sits nearly 9° north of π⁶, which is a remarkable spread
  // for one Bayer designation and is why the shield is so wide.
  { id: "π¹ Ori", name: "Pi1 Orionis", ra: 4.914925, dec: 10.150832, mag: 4.74, tone: "bone" }, // A3 Va
  { id: "π² Ori", name: "Pi2 Orionis", ra: 4.843534, dec: 8.900181, mag: 4.35, tone: "bone" }, // A1 Vn
  { id: "π³ Ori", name: "Tabit", ra: 4.830448, dec: 6.961275, mag: 3.16, tone: "bone" }, // F6 V
  { id: "π⁴ Ori", name: "Pi4 Orionis", ra: 4.853435, dec: 5.605103, mag: 3.69, tone: "blue" }, // B2 III
  { id: "π⁵ Ori", name: "Pi5 Orionis", ra: 4.904193, dec: 2.440673, mag: 3.69, tone: "blue" }, // B2 III
  { id: "π⁶ Ori", name: "Pi6 Orionis", ra: 4.975806, dec: 1.714016, mag: 4.47, tone: "amber" }, // K0/1 III

  // Appended rather than filed with the club so the indices above stay put.
  // 69 Ori has no Bayer letter, which is why it gets left out of hand-drawn
  // figures — but the club doesn't close without it, and an open club is what
  // makes the arm look broken.
  { id: "69 Ori", name: "69 Orionis", ra: 6.200911, dec: 16.130406, mag: 4.92, tone: "blue" }, // B5 Vn
];

/**
 * The asterism — which stars get joined by a line. Indices into ORION_STARS.
 * This is the figure people actually draw, not a Delaunay triangulation of it.
 *
 * Ordered core-outward, because the array order is also the order the lines
 * trace themselves on screen: the recognisable hourglass first, then the
 * sword, then the club and the shield growing out of the shoulders.
 */
export const ORION_EDGES: [number, number][] = [
  // Torso. A closed hourglass: shoulders across the top, belt through the
  // middle, feet across the bottom.
  [0, 1], // shoulder to shoulder
  [7, 0], // head to Betelgeuse
  [7, 1], // head to Bellatrix
  [0, 4], // Betelgeuse down to Alnitak
  [1, 2], // Bellatrix down to Mintaka
  [2, 3], // belt
  [3, 4], // belt
  [4, 6], // Alnitak down to Saiph
  [2, 5], // Mintaka down to Rigel
  [6, 5], // Saiph across to Rigel — closes the lower body

  // Sword, hanging from the middle of the belt. It hangs off Alnilam, not
  // Alnitak: 42 Ori sits at 5h35m and Alnilam at 5h36m, four arcminutes apart
  // in right ascension, so the sword drops almost vertically. Hung off Alnitak
  // it drags 25° off true and stops looking like a sword.
  [3, 8],
  [8, 9],
  [9, 10],

  // Right arm, raised, holding the club. The club head is a closed loop
  // — ξ, ν, χ¹, χ², 69 — with the forearm forking from the elbow to two of its
  // corners, which is what a hand gripping a haft looks like. Drawn as a single
  // zigzag chain instead, it reads as a broken limb.
  [0, 11], // Betelgeuse out to the elbow at μ
  [11, 12], // forearm forks to the grip
  [11, 13],
  [12, 13], // and the club head closes around
  [12, 22],
  [22, 14],
  [14, 15],
  [15, 13],

  // Left arm, extended, holding the shield
  [1, 18], // Bellatrix reaching west to Tabit, the brightest of the π stars
  [16, 17], // and the shield itself, arcing north to south
  [17, 18],
  [18, 19],
  // Full reference figures route π⁴→π⁵ via 5 Orionis (HIP 22730, M1 III,
  // mag 5.32). Omitted on purpose: it sits 13.7 arcminutes from π⁵ — they are
  // a naked-eye visual double — so at this scale it lands about five pixels
  // away and reads as a smudge on π⁵ rather than a star. The detour it adds to
  // this line bulges by less than five pixels too, which is to say none.
  [19, 20],
  [20, 21],
];

/** Tangent-plane centre. Roughly the middle of the figure, just west of the belt. */
const RA_CENTRE = 5.53;
const DEC_CENTRE = 0;

export type ProjectedStar = {
  /** Degrees east/west of centre, already flipped so the sky reads correctly. */
  x: number;
  /** Degrees north/south of centre, flipped so screen-down is positive. */
  y: number;
  mag: number;
  tone: CatalogStar["tone"];
  name: string;
};

/**
 * Flat projection onto the tangent plane at (RA_CENTRE, DEC_CENTRE).
 *
 * Right ascension increases eastward, which is *leftward* when you're looking
 * up at the sky, so x is negated — otherwise you get a mirrored Orion, and
 * anyone who has actually looked at the winter sky would notice.
 */
export function projectStar(star: CatalogStar): ProjectedStar {
  const deltaRaDegrees = (star.ra - RA_CENTRE) * 15;
  const decRadians = (star.dec * Math.PI) / 180;

  return {
    x: -deltaRaDegrees * Math.cos(decRadians),
    y: -(star.dec - DEC_CENTRE),
    mag: star.mag,
    tone: star.tone,
    name: star.name,
  };
}

const RAW_PROJECTION = ORION_STARS.map(projectStar);

/**
 * Bounding box of the projected figure, then everything is shifted so that box
 * is centred on the origin.
 *
 * Necessary because the club reaches to declination +20° while the feet only
 * reach −10°: taking the tangent point as the centre would hang the figure well
 * below the middle of the frame and waste the bottom third of the hero. Derived
 * rather than hand-tuned so that adding or removing a star can't silently
 * knock the composition off-centre again.
 */
const bounds = RAW_PROJECTION.reduce(
  (box, star) => ({
    minX: Math.min(box.minX, star.x),
    maxX: Math.max(box.maxX, star.x),
    minY: Math.min(box.minY, star.y),
    maxY: Math.max(box.maxY, star.y),
  }),
  { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
);

const centreX = (bounds.minX + bounds.maxX) / 2;
const centreY = (bounds.minY + bounds.maxY) / 2;

export const PROJECTED_ORION: ProjectedStar[] = RAW_PROJECTION.map((star) => ({
  ...star,
  x: star.x - centreX,
  y: star.y - centreY,
}));

/** Half-extents in degrees. The figure is markedly taller than it is wide. */
export const ORION_HALF_WIDTH_DEGREES = (bounds.maxX - bounds.minX) / 2;
export const ORION_HALF_HEIGHT_DEGREES = (bounds.maxY - bounds.minY) / 2;

/**
 * Magnitude to a 0–1 brightness. The scale is logarithmic and inverted — each
 * step of 1 mag is ~2.512x the flux — so a linear ramp would make Rigel and
 * Meissa look far too similar. Clamped to keep the dim sword stars visible.
 */
export function magnitudeToBrightness(mag: number): number {
  const brightest = 0.1;
  const faintest = 4.8;
  // Clamped *before* the exponent, not after. 69 Ori is magnitude 4.92 — fainter
  // than the floor — so it normalises negative, and a negative base under a
  // fractional exponent is NaN. Clamping only the result let that NaN through
  // both Math.max and Math.min untouched, and a star with a NaN radius simply
  // never drew: the club's loop has been missing a corner in the hero.
  const normalized = Math.min(1, Math.max(0, (faintest - mag) / (faintest - brightest)));
  return Math.max(0.12, normalized ** 1.45);
}

/**
 * The unit the canvas normalises star coordinates by — the larger half-extent,
 * so normalised coordinates land in [-1, 1] on the figure's long axis and
 * inside that on the short one.
 */
export const ORION_RADIUS_DEGREES = Math.max(
  ORION_HALF_WIDTH_DEGREES,
  ORION_HALF_HEIGHT_DEGREES,
);

/** Normalised half-extents, for fitting the figure to a viewport of any shape. */
export const ORION_HALF_WIDTH = ORION_HALF_WIDTH_DEGREES / ORION_RADIUS_DEGREES;
export const ORION_HALF_HEIGHT = ORION_HALF_HEIGHT_DEGREES / ORION_RADIUS_DEGREES;

/**
 * Projects any sky position into the same normalised frame the constellation is
 * drawn in, so anything tied to real coordinates — a meteor radiant, say —
 * lands in the right place relative to the figure and moves with it.
 */
export function skyToFigure(ra: number, dec: number): { x: number; y: number } {
  const projected = projectStar({ id: "", name: "", ra, dec, mag: 0, tone: "bone" });
  return {
    x: (projected.x - centreX) / ORION_RADIUS_DEGREES,
    y: (projected.y - centreY) / ORION_RADIUS_DEGREES,
  };
}

/** Degrees per normalised unit — the inverse of the fit, for angular maths. */
export const DEGREES_PER_UNIT = ORION_RADIUS_DEGREES;

/**
 * The Orionids: 06h 21m, +15.6°, roughly 10° from Betelgeuse and sitting right
 * inside the club. Debris from Halley's Comet, hitting the atmosphere at about
 * 66 km/s, which makes them among the fastest meteors there are. They peak
 * around 21 October at a zenithal hourly rate near 20.
 *
 * It is the only shower that belongs in this hero, and it happens to radiate
 * from the part of the figure we just finished drawing.
 */
export const ORIONID_RADIANT = skyToFigure(6.35, 15.6);
