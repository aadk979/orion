import type { Folder, Meta, MetaJsonFile, PageMapItem } from "nextra";

export type NavNode = {
  title: string;
  route: string;
  order: number;
  children?: NavNode[];
};

function isMetaFile(item: PageMapItem): item is MetaJsonFile {
  return "data" in item;
}

function isFolder(item: PageMapItem): item is Folder {
  return "children" in item;
}

function titleCase(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function resolveTitle(meta: Meta | undefined, fallback: string): string {
  if (typeof meta === "string") return meta;
  if (meta && typeof meta === "object" && typeof meta.title === "string") {
    return meta.title;
  }
  return fallback;
}

function isHidden(meta: Meta | undefined): boolean {
  return Boolean(
    meta &&
      typeof meta === "object" &&
      (meta as Record<string, unknown>).display === "hidden",
  );
}

/**
 * `getPageMap()` returns the whole project's page map with everything under
 * `contentDirBasePath` nested inside synthetic folders for that path. This
 * unwraps them so the sidebar's top level is the actual sections, not the
 * wrappers.
 *
 * One synthetic folder per path segment, not one per base path: Nextra builds
 * the wrappers by splitting the base on "/", so `/versions/alpine/docs` yields
 * three nested folders and only the innermost carries the sections. Matching
 * the full base against the top level found nothing and silently emptied the
 * sidebar, so this descends a segment at a time.
 */
export function getDocsNavTree(pageMap: PageMapItem[], basePath: string): NavNode[] {
  const segments = basePath.split("/").filter(Boolean);

  let children = pageMap;
  let route = "";

  for (const segment of segments) {
    route += `/${segment}`;
    const folder = children.find(
      (item): item is Folder => isFolder(item) && item.route === route,
    );
    if (!folder) return [];
    children = folder.children;
  }

  return buildNavTree(children);
}

/**
 * Turns Nextra's raw page map (folders / mdx files / _meta.ts data) into an
 * ordered tree the sidebar, mobile drawer, and search index all consume.
 */
export function buildNavTree(pageMap: PageMapItem[]): NavNode[] {
  const metaFile = pageMap.find(isMetaFile);
  const metaData = metaFile?.data ?? {};
  const orderedKeys = Object.keys(metaData);

  const nodes: NavNode[] = [];

  for (const item of pageMap) {
    if (isMetaFile(item)) continue;
    if (item.name === "index") continue;

    const meta = metaData[item.name];
    if (isHidden(meta)) continue;

    if (isFolder(item)) {
      nodes.push({
        title: resolveTitle(meta, titleCase(item.name)),
        route: item.route,
        order: orderedKeys.indexOf(item.name),
        children: buildNavTree(item.children),
      });
      continue;
    }

    const frontMatterTitle =
      typeof item.frontMatter?.title === "string"
        ? item.frontMatter.title
        : undefined;

    nodes.push({
      title: resolveTitle(meta, frontMatterTitle ?? titleCase(item.name)),
      route: item.route,
      order: orderedKeys.indexOf(item.name),
    });
  }

  return nodes.sort((a, b) => {
    if (a.order === -1 && b.order === -1) return a.title.localeCompare(b.title);
    if (a.order === -1) return 1;
    if (b.order === -1) return -1;
    return a.order - b.order;
  });
}

export function flattenNav(tree: NavNode[]): NavNode[] {
  return tree.flatMap((node) => [
    node,
    ...(node.children ? flattenNav(node.children) : []),
  ]);
}

export function findActiveTrail(tree: NavNode[], route: string): NavNode[] {
  for (const node of tree) {
    if (node.route === route) return [node];
    if (node.children) {
      const trail = findActiveTrail(node.children, route);
      if (trail.length) return [node, ...trail];
    }
  }
  return [];
}

export function getPrevNext(
  tree: NavNode[],
  route: string,
): { prev: NavNode | null; next: NavNode | null } {
  const flat = flattenNav(tree).filter((node) => !node.children);
  const index = flat.findIndex((node) => node.route === route);
  if (index === -1) return { prev: null, next: null };
  return {
    prev: index > 0 ? flat[index - 1] : null,
    next: index < flat.length - 1 ? flat[index + 1] : null,
  };
}
