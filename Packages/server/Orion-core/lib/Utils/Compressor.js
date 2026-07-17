async function compressString(str) {
  const encoded = new TextEncoder().encode(str);
  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  writer.write(encoded);
  writer.close();
  const compressed = await new Response(stream.readable).arrayBuffer();
  return btoa(String.fromCharCode(...new Uint8Array(compressed)));
}

async function decompressString(base64) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const stream = new DecompressionStream("gzip");
  const writer = stream.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const decompressed = await new Response(stream.readable).arrayBuffer();
  return new TextDecoder().decode(decompressed);
}

function compressURLs(urls) {
  return urls.map(url => {
    const prefix = url.startsWith('https://') ? 's' : 'o';
    const stripped = url.replace(/^https?:\/\//, '');
    return `${prefix}:${stripped}`;
  });
}

function decompressURLs(compressed) {
  return compressed.map(entry => {
    const protocol = entry[0] === 's' ? 'https' : 'http';
    const rest = entry.slice(2);
    return `${protocol}://${rest}`;
  });
}

export { compressString, decompressString, compressURLs, decompressURLs }