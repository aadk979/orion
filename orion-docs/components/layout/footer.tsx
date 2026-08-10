import Link from "next/link";
import { footerNav, siteConfig } from "@/lib/site-config";
import { Divider } from "@/components/ui/divider";
import { SourceLink } from "@/components/ui/source-link";
import { OrionLockup } from "@/components/ui/orion-mark";

export function Footer() {
  return (
    <footer className="mt-auto">
      <Divider />
      <div className="mx-auto w-full max-w-(--width-content) px-6 py-16">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-5">
          <div className="col-span-2">
            <OrionLockup className="text-text-primary" />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-text-tertiary">
              {siteConfig.tagline}
            </p>
            <SourceLink className="mt-5" />
          </div>

          {footerNav.map((group) => (
            <div key={group.title}>
              <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
                {group.title}
              </p>
              <ul className="mt-3 space-y-2.5">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-text-tertiary transition-colors hover:text-text-primary"
                    >
                      {link.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col gap-2 border-t border-border-faint pt-6 text-xs text-text-tertiary sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} {siteConfig.name}. MIT licensed.</span>
          <span>Built for distributed systems.</span>
        </div>
      </div>
    </footer>
  );
}
