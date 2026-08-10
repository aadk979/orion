import { ImageResponse } from "next/og";
import { siteConfig } from "@/lib/site-config";

/**
 * The social card, rendered once at build time.
 *
 * Every scraper — X, Slack, Discord, LinkedIn, iMessage — crops toward
 * 1200×630, so the composition is built for that and nothing else. Drawn here
 * rather than shipped as a PNG so the wording tracks `siteConfig`: a card that
 * still shows last quarter's tagline is worse than no card.
 *
 * Satori (what `ImageResponse` renders with) supports a deliberate subset of
 * CSS — flexbox, no grid, and every element with more than one child needs an
 * explicit `display: flex`. It also cannot reach the network under a static
 * export, so this uses system fonts and no images.
 */
export const alt = `${siteConfig.name} — ${siteConfig.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// An image route is a route handler, and under `output: "export"` every route
// handler has to declare that it can be resolved at build time or the build
// refuses to guess.
export const dynamic = "force-static";

/** Matches `--orion-amber` and the ink the manifest and mark are set on. */
const AMBER = "#F0A02A";
const INK = "#14120E";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: INK,
          padding: "80px",
          // The sky the hero draws, reduced to something Satori can express:
          // a warm glow off the upper right, falling into ink.
          backgroundImage: `radial-gradient(1000px 620px at 78% 8%, rgba(240,160,42,0.20), rgba(20,18,14,0) 62%)`,
          fontFamily: "Georgia, serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <div
            style={{
              width: "22px",
              height: "22px",
              borderRadius: "50%",
              background: AMBER,
              boxShadow: `0 0 40px 12px rgba(240,160,42,0.55)`,
            }}
          />
          <div
            style={{
              fontSize: "30px",
              letterSpacing: "0.32em",
              textTransform: "uppercase",
              color: "#EDEAE3",
            }}
          >
            {siteConfig.name}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: "76px",
              lineHeight: 1.08,
              color: "#EDEAE3",
              letterSpacing: "-0.02em",
              maxWidth: "980px",
            }}
          >
            Authentication you run yourself.
          </div>
          <div
            style={{
              marginTop: "28px",
              fontSize: "31px",
              lineHeight: 1.4,
              color: "rgba(237,234,227,0.66)",
              maxWidth: "900px",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            {siteConfig.tagline}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "18px",
            fontSize: "25px",
            color: "rgba(237,234,227,0.42)",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div style={{ display: "flex" }}>Sessions</div>
          <div style={{ display: "flex", color: AMBER }}>·</div>
          <div style={{ display: "flex" }}>Passkeys</div>
          <div style={{ display: "flex", color: AMBER }}>·</div>
          <div style={{ display: "flex" }}>TOTP</div>
          <div style={{ display: "flex", color: AMBER }}>·</div>
          <div style={{ display: "flex" }}>OAuth</div>
          <div style={{ display: "flex", color: AMBER }}>·</div>
          <div style={{ display: "flex" }}>Cluster control plane</div>
        </div>
      </div>
    ),
    size,
  );
}
