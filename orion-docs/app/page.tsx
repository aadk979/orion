import {
  Boxes,
  GitBranch,
  KeyRound,
  Lock,
  Radar,
  ShieldCheck,
} from "lucide-react";
import { Hero } from "@/components/marketing/hero";
import { FadeIn } from "@/components/animations/fade-in";
import { StaggerChildren } from "@/components/animations/stagger-children";
import { Button } from "@/components/ui/button";
import { Section, SectionHeading } from "@/components/ui/section";
import { Grid } from "@/components/ui/grid";
import { FeatureCard } from "@/components/ui/feature-card";
import { MetricCard } from "@/components/ui/metric-card";
import { Architecture } from "@/components/docs/architecture-diagram";
import { AuthFlow } from "@/components/docs/auth-flow";
import { docs } from "@/lib/site-config";
import { currentVersion, isPending } from "@/lib/versions";
import { pageMetadata, softwareApplicationJsonLd } from "@/lib/seo";
import { JsonLd } from "@/components/seo/json-ld";

// No `title`, so the root layout's default stands — it is the one page whose
// title should be the site's own rather than a section of it.
export const metadata = pageMetadata({
  title: "Self-hosted authentication for Node.js",
  path: "/",
});


const features = [
  {
    icon: ShieldCheck,
    title: "Sessions & tokens",
    description:
      "Rotating access/refresh pairs with reuse detection, four configurable binding tiers, and opt-in DPoP proof-of-possession.",
  },
  {
    icon: Boxes,
    title: "Cluster control plane",
    description:
      "Orion-Orchestrator supervises the fleet — health states, consensus votes, alerts, and an allowlisted command surface.",
  },
  {
    icon: KeyRound,
    title: "Passkeys, TOTP & OAuth",
    description:
      "WebAuthn with server-side single-use ceremonies, TOTP sealed at rest, and OAuth keyed on the provider subject.",
  },
  {
    icon: Radar,
    title: "Abuse defense",
    description:
      "A pre-parse flood guard, per-actor token buckets with per-route costs, and auth-failure blocking wired in centrally.",
  },
  {
    icon: GitBranch,
    title: "Migrations that fit a fleet",
    description:
      "Versioned, checksummed, advisory-locked schema changes. Boot every node at once — exactly one applies them.",
  },
  {
    icon: Lock,
    title: "PBAC admin plane",
    description:
      "Every operator behind policy, magic link plus mandatory TOTP, and an audit table the database refuses to let you edit.",
  },
];

const metrics = [
  { label: "Auth endpoints", value: "35", hint: "registered on boot" },
  { label: "Security tiers", value: "1–4", hint: "configurable token binding" },
  { label: "Backing services", value: "1", hint: "Postgres is the only hard dependency" },
];

export default function HomePage() {
  return (
    <>
      {/* What the project is, for a parser that will not read the prose. */}
      <JsonLd data={softwareApplicationJsonLd()} />

      <Hero />

      <Section size="sm">
        <Grid columns={3}>
          {metrics.map((metric) => (
            <MetricCard key={metric.label} {...metric} />
          ))}
        </Grid>
      </Section>

      <Section id="features">
        <SectionHeading
          eyebrow="Everything, built in"
          title="The parts every serious deployment ends up building anyway."
          description="One coherent system: an Express app your service embeds, a control plane that supervises the fleet, and a browser SDK that drives the ceremonies."
        />
        <StaggerChildren>
          <Grid columns={3}>
            {features.map((feature) => (
              <FeatureCard
                key={feature.title}
                title={feature.title}
                description={feature.description}
                icon={<feature.icon className="size-4.5" strokeWidth={1.75} />}
              />
            ))}
          </Grid>
        </StaggerChildren>
      </Section>

      <Section id="architecture">
        <SectionHeading
          eyebrow="How it fits together"
          title="One control plane, any number of auth nodes."
          description="Every Orion-core node embeds directly in your app and holds no state between requests — Postgres holds the data, Redis shares the signing keys, and R_Sync carries control-plane traffic only."
        />
        <FadeIn>
          <Architecture />
        </FadeIn>
      </Section>

      <Section id="sign-in-flow">
        <SectionHeading
          eyebrow="See it in action"
          title="A single sign-in, end to end."
          description="Credentials verified, the device recognized or challenged, and a linked token pair written as HttpOnly cookies — bound to the client context by the security tier you choose."
        />
        <FadeIn>
          <AuthFlow />
        </FadeIn>
      </Section>

      <Section size="lg" className="text-center">
        <FadeIn>
          <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-balance text-text-primary md:text-4xl">
            Ready to run authentication you actually own?
          </h2>
          {/* The documentation is published ahead of the edition it documents,
              so the invitation is to read rather than to install — saying
              "point a node at Postgres" to someone who cannot yet obtain the
              package is the single most annoying thing a pre-release site can
              do. This reverts to the install pitch the moment Alpine ships. */}
          <p className="mx-auto mt-4 max-w-lg text-lg text-text-secondary">
            {isPending(currentVersion) ? (
              <>
                Edition 001 is on file and not yet issued — but the documentation is complete and
                open, down to the last configuration key.
              </>
            ) : (
              <>
                Point a node at Postgres, call <code>initiateServer()</code>, and complete a real
                sign-in from the browser.
              </>
            )}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button href={docs("getting-started")} size="lg">
              Get started
            </Button>
            <Button href={docs()} variant="secondary" size="lg">
              Browse the docs
            </Button>
          </div>
        </FadeIn>
      </Section>
    </>
  );
}
