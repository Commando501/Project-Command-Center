import { describe, expect, test } from 'vitest';

import {
  GITHUB_API_ORIGIN,
  ReleaseClientError,
  downloadAssetBytes,
  downloadJsonAsset,
  findReleaseAsset,
  getLatestStableRelease,
  getReleaseByTag,
  getReleaseForVersion,
  publicRequestInit
} from '../src/updater/github-release-client.js';

const okJson = (value) => ({
  ok: true,
  status: 200,
  json: async () => value,
  arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(value)).buffer
});

const recorder = (response = okJson({ tag_name: 'v4.1.0', assets: [] })) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return typeof response === 'function' ? response(url, init) : response;
  };
  return { calls, fetchImpl };
};

describe('request construction', () => {
  test('asks the documented public endpoint for the latest release', async () => {
    const { calls, fetchImpl } = recorder();
    await getLatestStableRelease('owner/repo', fetchImpl);
    expect(calls[0].url).toBe(`${GITHUB_API_ORIGIN}/repos/owner/repo/releases/latest`);
  });

  test('asks for an exact tag when verifying a manual file', async () => {
    const { calls, fetchImpl } = recorder();
    await getReleaseByTag('owner/repo', 'v4.1.0', fetchImpl);
    expect(calls[0].url).toBe(`${GITHUB_API_ORIGIN}/repos/owner/repo/releases/tags/v4.1.0`);

    await getReleaseForVersion('owner/repo', '4.2.0', fetchImpl);
    expect(calls[1].url).toBe(`${GITHUB_API_ORIGIN}/repos/owner/repo/releases/tags/v4.2.0`);
  });

  test('sends the GitHub JSON accept header', async () => {
    const { calls, fetchImpl } = recorder();
    await getLatestStableRelease('owner/repo', fetchImpl);
    expect(calls[0].init.headers.Accept).toBe('application/vnd.github+json');
  });

  test('does not pin an API version header', () => {
    // GitHub answers 400 for an unrecognised X-GitHub-Api-Version, so pinning
    // a value this code cannot verify would be a guaranteed future outage.
    expect(Object.keys(publicRequestInit())).not.toContain('X-GitHub-Api-Version');
    expect(publicRequestInit().headers['X-GitHub-Api-Version']).toBeUndefined();
  });

  test('is an unauthenticated, bodyless, referrer-free GET', () => {
    const init = publicRequestInit();
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
    expect(init.cache).toBe('no-store');
    expect(Object.keys(init.headers)).toEqual(['Accept']);
  });

  test('refuses a repository slug that is not owner/name', async () => {
    const { fetchImpl } = recorder();
    for (const slug of ['', 'no-slash', 'a/b/c', '../../etc', null, 'owner/repo?x=1']) {
      await expect(getLatestStableRelease(slug, fetchImpl)).rejects.toThrow(ReleaseClientError);
    }
  });
});

describe('failure handling', () => {
  test('a network failure becomes a readable error, not a crash', async () => {
    const failing = async () => { throw new TypeError('Failed to fetch'); };
    await expect(getLatestStableRelease('owner/repo', failing))
      .rejects.toThrow(/Could not reach the update server/);
  });

  test('a non-2xx response carries its status', async () => {
    const notFound = { ok: false, status: 404 };
    await expect(getLatestStableRelease('owner/repo', async () => notFound))
      .rejects.toMatchObject({ status: 404 });
  });

  test('unreadable JSON is reported rather than thrown raw', async () => {
    const broken = { ok: true, status: 200, json: async () => { throw new Error('bad json'); } };
    await expect(getLatestStableRelease('owner/repo', async () => broken))
      .rejects.toThrow(/unreadable JSON/);
  });
});

describe('assets', () => {
  const release = {
    assets: [
      { name: 'update-manifest.json', browser_download_url: 'https://example.com/m.json', size: 10, digest: null },
      { name: 'app.html', browser_download_url: 'https://example.com/app.html', size: 20, digest: 'sha256:abc' }
    ]
  };

  test('finds an asset by exact name', () => {
    expect(findReleaseAsset(release, 'app.html')).toEqual({
      name: 'app.html',
      browser_download_url: 'https://example.com/app.html',
      size: 20,
      digest: 'sha256:abc'
    });
  });

  test('returns null for a missing asset or a malformed release', () => {
    expect(findReleaseAsset(release, 'nope.html')).toBeNull();
    expect(findReleaseAsset({}, 'app.html')).toBeNull();
    expect(findReleaseAsset(null, 'app.html')).toBeNull();
  });

  test('a missing digest is tolerated, since it is optional', () => {
    expect(findReleaseAsset(release, 'update-manifest.json').digest).toBeNull();
  });

  test('downloads asset bytes rather than decoded text', async () => {
    const payload = new TextEncoder().encode('<html>é</html>');
    const fetchImpl = async () => ({ ok: true, status: 200, arrayBuffer: async () => payload.buffer });
    const bytes = await downloadAssetBytes(
      { browser_download_url: 'https://example.com/app.html' }, fetchImpl
    );
    // Hashing must see the exact bytes; a text round trip could change them.
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect([...bytes]).toEqual([...payload]);
  });

  test('refuses a download url that is not https', async () => {
    for (const url of ['http://example.com/a.html', 'file:///etc/passwd', 'javascript:alert(1)', '']) {
      await expect(downloadAssetBytes({ browser_download_url: url }, async () => ({})))
        .rejects.toThrow(/no usable https download url/);
    }
  });

  test('reports a manifest that is not valid JSON', async () => {
    const fetchImpl = async () => ({
      ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('{nope}').buffer
    });
    await expect(downloadJsonAsset({ browser_download_url: 'https://example.com/m.json' }, fetchImpl))
      .rejects.toThrow(/not valid JSON/);
  });
});
