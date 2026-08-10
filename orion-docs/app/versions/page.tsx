import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, GitBranch } from "lucide-react";
import { Section, SectionHeading } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Grid } from "@/components/ui/grid";
import { FadeIn } from "@/components/animations/fade-in";
import { AnimatedGrid } from "@/components/background/animated-grid";
import { VersionThread } from "@/components/versions/version-thread";
import { VersionLadder } from "@/components/versions/version-ladder";
import { Stamp } from "@/components/ui/stamp";
import { pageMetadata } from "@/lib/seo";
import { pendingCopy } from "@/lib/release-status";
import {
  VERSIONS_BASE_PATH,
  anyPublished,
  isPending,
  publicationLabel,
  unwrittenBranches,
  versionDocsRoute,
  versionRoute,
  versions,
  versionsNewestFirst,
} from "@/lib/versions";

export const metadata: Metadata = pageMetadata({
  title: "Editions",
  description:
    "Every edition of Orion on file, in the order it happened — what each one is, whether it has been issued, and the documentation that comes with it.",
  path: VERSIONS_BASE_PATH,
});

export default function VersionsPage() {
  return (
    <>
      <Section size="sm" className="pb-0">
        <SectionHeading
          eyebrow="The record"
          headingAs="h1"
          title="Every edition, in the order it happened."
          description="Orion ships as named editions, and the documentation is versioned with them — each edition keeps the docs it was published with, frozen at the state of the system it describes. The first edition is on file and not yet issued; its documentation is open regardless. Pick a point on the thread."
        />
      </Section>

      {/* The thread breaks out of `Section` so its atmosphere can run edge to
          edge, but the drawing itself stays on the content measure — the
          headings above it and the cards below are the alignment it has to
          hold, and its branch labels are sized against that width. */}
      <div className="relative overflow-hidden">
        <AnimatedGrid className="opacity-30" animate={false} fade="radial" />

        <div className="relative mx-auto w-full max-w-(--width-content) px-6 pb-4">
          <VersionThread className="hidden lg:block" />
          <VersionLadder className="py-4 lg:hidden" />
        </div>
      </div>

      <Section size="sm">
        <div className="mb-8 flex items-baseline justify-between gap-4">
          {/* "Published" would be a lie while nothing has been issued, and the
              heading is the one line on this page a skimmer definitely reads. */}
          <h2 className="text-2xl font-semibold tracking-tight text-text-primary">
            {anyPublished ? "Published editions" : "Editions on file"}
          </h2>
          <span className="font-mono text-xs uppercase tracking-wide text-text-faint">
            {versions.length} {versions.length === 1 ? "edition" : "editions"}
          </span>
        </div>

        <div className="flex flex-col gap-4">
          {versionsNewestFirst.map((version) => (
            <FadeIn key={version.slug}>
              <Card
                hoverable={false}
                className="flex flex-col gap-6 md:flex-row md:items-start md:gap-10"
              >
                <div className="flex shrink-0 items-center gap-3 md:w-52 md:flex-col md:items-start">
                  <span className="font-mono text-4xl font-semibold tabular-nums tracking-tight text-text-faint">
                    {String(version.ordinal).padStart(3, "0")}
                  </span>
                  <div className="md:mt-1">
                    {/* A pending edition gets the stamp rather than the badge.
                        The two are not interchangeable: a badge is a label the
                        edition carries, and the stamp is something done *to*
                        the file. Only one edition on this page can be pending
                        at a time, so the stamp stays rare enough to work. */}
                    {isPending(version) ? (
                      <Stamp size="sm" rotate={-3} impact={false}>
                        {pendingCopy.stamp}
                      </Stamp>
                    ) : (
                      <Badge tone={version.status === "current" ? "accent" : "neutral"}>
                        {version.status === "current" ? "Current" : "Archived"}
                      </Badge>
                    )}
                    <p className="mt-2.5 font-mono text-[0.65rem] uppercase tracking-wide text-text-faint">
                      {isPending(version)
                        ? `Issue ${pendingCopy.awaiting}`
                        : `Published ${publicationLabel(version)}`}
                    </p>
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <CardTitle className="text-xl">
                    <Link
                      href={versionRoute(version)}
                      className="transition-colors hover:text-accent-bright"
                    >
                      {version.name}
                    </Link>
                  </CardTitle>
                  <CardDescription className="mt-2 text-base">
                    {version.tagline}
                  </CardDescription>

                  <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                    <Link
                      href={versionRoute(version)}
                      className="group inline-flex items-center gap-1.5 font-medium text-accent-bright"
                    >
                      {isPending(version) ? `About ${version.name}` : `What’s in ${version.name}`}
                      <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                    {version.hasDocs && (
                      <Link
                        href={versionDocsRoute(version)}
                        className="group inline-flex items-center gap-1.5 text-text-tertiary transition-colors hover:text-text-primary"
                      >
                        <BookOpen className="size-3.5" />
                        Documentation
                      </Link>
                    )}
                  </div>

                  {/* The pinned package versions are part of what an edition
                      publishes, so they are withheld with it. The row is not
                      left blank — it says why, in the same slot, so the card
                      reads as sealed rather than as half-built. */}
                  {isPending(version) ? (
                    <p className="mt-6 border-t border-border-faint pt-5 font-mono text-[0.65rem] uppercase tracking-wide text-text-faint">
                      Manifest {pendingCopy.sealed} · Change record {pendingCopy.sealed} ·
                      Documentation open
                    </p>
                  ) : (
                    <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3 border-t border-border-faint pt-5">
                      {version.packages.slice(0, 4).map((pkg) => (
                        <div key={pkg.name}>
                          <dt className="font-mono text-[0.65rem] uppercase tracking-wide text-text-faint">
                            {pkg.name}
                          </dt>
                          <dd className="mt-0.5 font-mono text-sm tabular-nums text-text-secondary">
                            {pkg.version}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              </Card>
            </FadeIn>
          ))}
        </div>
      </Section>

      <Section size="sm">
        <SectionHeading
          eyebrow="Unwritten"
          title="Where the thread frays."
          description="The branches hanging off today are directions the repository is visibly heading — open extension points, partially generalised systems, and gaps the code itself flags. None of them are editions, and none of them are dated."
        />
        <Grid columns={3}>
          {unwrittenBranches.map((branch) => (
            <Card key={branch.title} hoverable={false} className="border-dashed">
              <GitBranch className="size-4 text-accent/50" strokeWidth={1.75} />
              <CardTitle className="mt-3 text-base text-text-secondary">
                {branch.title}
              </CardTitle>
              <CardDescription className="mt-2 text-text-tertiary">
                {branch.note}
              </CardDescription>
            </Card>
          ))}
        </Grid>
      </Section>
    </>
  );
}
