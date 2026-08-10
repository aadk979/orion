// Submit the canonical URLs from the built sitemap after Firebase has deployed
// them. IndexNow verifies ownership through the matching public key file.
//
// Run `npm run indexnow` only after `firebase deploy`; submitting before the
// URLs are public tells crawlers to fetch a version that does not exist yet.

import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.dirname(import.meta.dirname);
const key = "bd9f20c681b34ee3880b54972864e0d1";
const sitemap = await readFile(path.join(root, "out", "sitemap-main.xml"), "utf8");
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);

if (urls.length === 0) {
  throw new Error("IndexNow submission stopped: the built sitemap contains no URLs.");
}

const origin = new URL(urls[0]).origin;
const keyLocation = `${origin}/${key}.txt`;
const verification = await fetch(keyLocation);

if (!verification.ok || (await verification.text()).trim() !== key) {
  throw new Error(`IndexNow submission stopped: deploy ${keyLocation} before notifying crawlers.`);
}

const response = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({
    host: new URL(origin).host,
    key,
    keyLocation,
    urlList: urls,
  }),
});

if (!response.ok) {
  throw new Error(`IndexNow submission failed (${response.status}): ${await response.text()}`);
}

console.log(`IndexNow: submitted ${urls.length} canonical URL(s) for ${origin}.`);
