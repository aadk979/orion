/**
 * The release gate.
 *
 * Orion is finishing its final phases. The documentation is finished enough to
 * read, so it is published; the software and its repository are not, so nothing
 * on this site may claim otherwise. That is the whole of the problem this file
 * exists to solve, and it solves it in one place on purpose — a "coming soon"
 * scattered across nine components is a "coming soon" that will still be in six
 * of them a year after launch.
 *
 * Flipping the site to launched is meant to be a small, boring diff:
 *
 *   1. `source.available` → `true` here.
 *   2. The edition's `status` → `"current"` and its `publishedOn` → a real date
 *      in `lib/versions.ts`.
 *
 * Nothing else should need touching. If you find yourself editing a component
 * to launch the site, that component is reading the release state wrong — fix
 * the component, not the copy.
 *
 * ---
 *
 * ## The register
 *
 * The pending state is written in the voice of a records office: an edition is
 * a numbered file that has been *opened* but not *issued*, held at a desk
 * pending clearance. The vocabulary lives here so it stays one voice — `SEALED`
 * in one place and "hidden for now" in another is two institutions, and the
 * whole effect depends on there only being one.
 *
 * The conceit is deliberately generic — forms, stamps, clearances, sealed
 * dockets — and shares nothing with any particular fiction's bureau: no
 * borrowed names, marks, mottos, mascots or slogans. It is the site's own
 * existing drafting-office chrome (ruled plates, registration marks, title
 * blocks) carried one step further into the room where the drawings are filed.
 */

export type SourceAvailability =
  | {
      /** The repository is public. Every source affordance becomes a real link. */
      available: true;
      url: string;
    }
  | {
      /** Not public yet. Source affordances render as pending, and never link. */
      available: false;
      /** Where it will live. Held here so launch is a boolean, not a search. */
      url: string;
    };

/**
 * Whether the public repository exists yet.
 *
 * Typed as the union above rather than inferred from the literal, so both
 * branches of every `source.available ?` in the site stay type-checked. Infer
 * it and the unreachable branch stops being verified, which is exactly the
 * branch that has to work on launch day.
 */
export const source: SourceAvailability = {
  available: false,
  url: "https://github.com/aadk979/orion",
};

/**
 * The vocabulary. Every string the pending state says out loud, in one object,
 * because the register only holds if the wording is literally shared.
 */
export const pendingCopy = {
  /** The stamp. Short enough to set at display tracking without wrapping. */
  stamp: "Not yet issued",
  /** What a source affordance says in place of a destination. */
  source: "Coming soon",
  /** A redacted field's value. Never a real value, never a guess at one. */
  sealed: "Sealed",
  /** A field whose value does not exist yet, as opposed to being withheld. */
  awaiting: "Pending",
  /** How a date reads before there is one. Used anywhere a date would go. */
  date: "Date pending",
  /** The status word for an edition that is on file but not out. */
  status: "Pending issue",
} as const;

/** The file number the pending plate is filed under. Derived, never typed out. */
export function fileNumber(ordinal: number): string {
  return `OR-${String(ordinal).padStart(3, "0")}`;
}
