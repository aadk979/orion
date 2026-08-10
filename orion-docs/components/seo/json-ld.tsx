/**
 * Emits structured data as JSON-LD.
 *
 * A server component with no client cost: the script tag is in the static HTML,
 * which is the only place a crawler will look for it.
 *
 * `<` is escaped to its unicode form because `JSON.stringify` will happily
 * write `</script>` into the middle of a script tag if a string in the payload
 * contains one, ending it early — the sanitisation Next's own JSON-LD guide
 * calls for.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
