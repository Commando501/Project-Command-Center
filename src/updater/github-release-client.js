import { REPOSITORY_SLUG_PATTERN } from './app-metadata.js';
import { tagForVersion } from './version.js';

/**
 * Minimal read-only client for public GitHub Releases.
 *
 * PRIVACY: every request here is a plain unauthenticated GET built entirely
 * from the repository slug and the release tag. No Data Capsule content
 * reaches the URL, the headers, or a body — there is never a body. Credentials
 * are omitted and the referrer suppressed so nothing about the user's file is
 * disclosed by the request itself.
 *
 * The X-GitHub-Api-Version header is deliberately NOT sent. GitHub rejects an
 * unrecognised value with 400, so pinning a version this code cannot verify
 * would be a guaranteed outage the day it drifts. Omitting it selects the
 * current supported version.
 */

export const GITHUB_API_ORIGIN = 'https://api.github.com';

export class ReleaseClientError extends Error {
  constructor(message, { status = null } = {}) {
    super(message);
    this.name = 'ReleaseClientError';
    this.status = status;
  }
}

function assertRepository(repository) {
  const slug = String(repository || '');
  if (!REPOSITORY_SLUG_PATTERN.test(slug)) {
    throw new ReleaseClientError(`Not a usable repository: ${JSON.stringify(repository)}`);
  }
  return slug;
}

/** Request options carrying nothing about the user or their data. */
export function publicRequestInit(accept = 'application/vnd.github+json') {
  return {
    method: 'GET',
    headers: { Accept: accept },
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
    mode: 'cors',
    redirect: 'follow'
  };
}

async function getJson(url, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, publicRequestInit());
  } catch (error) {
    // Offline, DNS failure, or a CORS rejection all land here. None of them
    // are worth interrupting the user over.
    throw new ReleaseClientError(`Could not reach the update server: ${error.message}`);
  }

  if (!response.ok) {
    throw new ReleaseClientError(
      `Update server returned ${response.status} for ${url}.`,
      { status: response.status }
    );
  }

  try {
    return await response.json();
  } catch (error) {
    throw new ReleaseClientError(`Update server returned unreadable JSON: ${error.message}`);
  }
}

export async function getLatestStableRelease(repository, fetchImpl = fetch) {
  const slug = assertRepository(repository);
  return getJson(`${GITHUB_API_ORIGIN}/repos/${slug}/releases/latest`, fetchImpl);
}

export async function getReleaseByTag(repository, tag, fetchImpl = fetch) {
  const slug = assertRepository(repository);
  return getJson(
    `${GITHUB_API_ORIGIN}/repos/${slug}/releases/tags/${encodeURIComponent(tag)}`,
    fetchImpl
  );
}

export async function getReleaseForVersion(repository, version, fetchImpl = fetch) {
  return getReleaseByTag(repository, tagForVersion(version), fetchImpl);
}

/** Finds a named asset. `digest` is present on newer releases and optional. */
export function findReleaseAsset(release, name) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const asset = assets.find(entry => entry?.name === name);
  if (!asset) return null;
  return {
    name: asset.name,
    browser_download_url: asset.browser_download_url,
    size: Number(asset.size) || 0,
    digest: asset.digest ?? null
  };
}

/** Downloads an asset as raw bytes. Hashing must use bytes, never decoded text. */
export async function downloadAssetBytes(asset, fetchImpl = fetch) {
  const url = String(asset?.browser_download_url || '');
  if (!/^https:\/\//i.test(url)) {
    throw new ReleaseClientError('Release asset has no usable https download url.');
  }

  let response;
  try {
    response = await fetchImpl(url, publicRequestInit('application/octet-stream'));
  } catch (error) {
    throw new ReleaseClientError(`Could not download the release: ${error.message}`);
  }
  if (!response.ok) {
    throw new ReleaseClientError(
      `Release download failed with status ${response.status}.`,
      { status: response.status }
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function downloadJsonAsset(asset, fetchImpl = fetch) {
  const bytes = await downloadAssetBytes(asset, fetchImpl);
  const text = new TextDecoder('utf-8').decode(bytes);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ReleaseClientError(`Release manifest is not valid JSON: ${error.message}`);
  }
}
