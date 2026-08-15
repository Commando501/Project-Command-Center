import { metadataRegionRegex, METADATA_END, METADATA_START } from '../../src/persistence/markers.js';
import { sha256Hex } from '../../src/updater/sha256.js';

export const REPOSITORY = 'owner/project-command-center';

/** Rewrites a built shell's release metadata to simulate a different release. */
export function reversionShell(html, overrides) {
  return html.replace(metadataRegionRegex(), (_match, json) => {
    const metadata = { ...JSON.parse(json), ...overrides };
    return `${METADATA_START}${JSON.stringify(metadata, null, 2)}${METADATA_END}`;
  });
}

export function assetUrl(name) {
  return `https://github.com/${REPOSITORY}/releases/download/v-test/${encodeURIComponent(name)}`;
}

/**
 * Builds a fake GitHub release plus a fetch implementation that serves it.
 * Every request the client makes is recorded so privacy can be asserted.
 */
export async function createFakeGitHub({
  version = '4.1.0',
  shellHtml,
  manifestOverrides = {},
  includeAssetDigest = true,
  omitManifestAsset = false,
  omitHtmlAsset = false,
  corruptBytes = false
} = {}) {
  const assetName = `Project-Command-Center-v${version}.html`;
  const bytes = new TextEncoder().encode(shellHtml);
  const servedBytes = corruptBytes
    ? new TextEncoder().encode(`${shellHtml}<!-- tampered -->`)
    : bytes;
  const digest = await sha256Hex(bytes);

  const manifest = {
    formatVersion: 1,
    appVersion: version,
    schemaVersion: 4,
    minSchemaVersion: 3,
    channel: 'stable',
    assetName,
    sha256: digest,
    publishedAt: '2026-08-14T22:00:00Z',
    releaseNotes: ['Verified update pipeline'],
    ...manifestOverrides
  };

  const assets = [];
  if (!omitManifestAsset) {
    assets.push({
      name: 'update-manifest.json',
      browser_download_url: assetUrl('update-manifest.json'),
      size: 512,
      digest: null
    });
  }
  if (!omitHtmlAsset) {
    assets.push({
      name: assetName,
      browser_download_url: assetUrl(assetName),
      size: servedBytes.byteLength,
      digest: includeAssetDigest ? `sha256:${digest}` : null
    });
  }

  const release = { tag_name: `v${version}`, name: `Release ${version}`, assets };
  const requests = [];

  const fetchImpl = async (url, init = {}) => {
    requests.push({ url: String(url), init });

    const respond = (body, contentType) => ({
      ok: true,
      status: 200,
      headers: { get: () => contentType },
      json: async () => JSON.parse(new TextDecoder().decode(body)),
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
    });

    if (String(url).includes('/releases/latest') || String(url).includes('/releases/tags/')) {
      return respond(new TextEncoder().encode(JSON.stringify(release)), 'application/json');
    }
    if (String(url).includes('update-manifest.json')) {
      return respond(new TextEncoder().encode(JSON.stringify(manifest)), 'application/json');
    }
    if (String(url).includes(encodeURIComponent(assetName))) {
      return respond(servedBytes, 'text/html');
    }
    return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  };

  return { version, assetName, manifest, release, digest, bytes, fetchImpl, requests };
}

export const offlineFetch = async () => {
  throw new TypeError('Failed to fetch');
};
