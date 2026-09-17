import { isIP } from 'node:net';

const MIN_CHROME_MAJOR = 138;
const OPERATION_TIMEOUT_MS = 30_000;
const MAX_DELETIONS = 1000;

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

function domainMatches(hostname, domain) {
  if (typeof domain !== 'string' || !domain) return false;
  const normalized = domain.toLowerCase();
  if (!normalized.startsWith('.')) return hostname === normalized;
  const base = normalized.slice(1);
  return hostname === base || (!isIP(hostname.replace(/^\[|\]$/g, '')) &&
    base.length > 0 && hostname.endsWith(`.${base}`));
}

function getFrame(response) {
  const frame = response?.frameTree?.frame;
  let url;
  try { url = new URL(frame?.url); } catch {}
  if (!url || !['http:', 'https:'].includes(url.protocol)) {
    throw failure('UNSUPPORTED_PAGE', 'Cookie clearing requires an HTTP(S) top-level page.');
  }
  if (typeof frame.id !== 'string' || !frame.id || typeof frame.loaderId !== 'string' || !frame.loaderId) {
    throw failure('PAGE_UNSTABLE', 'The current document identity could not be established.');
  }
  return { id: frame.id, loaderId: frame.loaderId, url: url.href, origin: url.origin, hostname: url.hostname, scheme: url.protocol.slice(0, -1) };
}

function assertFrame(initial, current) {
  if (initial.id !== current.id || initial.loaderId !== current.loaderId || initial.url !== current.url) {
    throw failure('DOCUMENT_CHANGED', 'The page changed during cookie clearing; no further cookies will be deleted.');
  }
}

function partition(cookie, scope, currentKeys) {
  // Even partitionKeyOpaque:false can represent a nonce partition that CDP cannot
  // serialize. Presence of this field is not evidence of an unpartitioned cookie.
  if (Object.hasOwn(cookie, 'partitionKeyOpaque')) return { kind: 'unknown' };
  if (!Object.hasOwn(cookie, 'partitionKey')) return { kind: 'unpartitioned' };
  const key = cookie.partitionKey;
  if (!key || typeof key !== 'object' || Array.isArray(key) ||
      Object.keys(key).some(field => !['topLevelSite', 'hasCrossSiteAncestor'].includes(field)) ||
      typeof key.topLevelSite !== 'string' || typeof key.hasCrossSiteAncestor !== 'boolean') {
    return { kind: 'unknown' };
  }
  let site;
  try { site = new URL(key.topLevelSite); } catch { return { kind: 'unknown' }; }
  if (!['http:', 'https:'].includes(site.protocol) || site.username || site.password || site.port ||
      site.pathname !== '/' || site.search || site.hash) return { kind: 'unknown' };
  if (key.hasCrossSiteAncestor || site.protocol !== `${scope.scheme}:` ||
      !domainMatches(scope.hostname, `.${site.hostname}`)) return { kind: 'other' };
  const identity = JSON.stringify([key.topLevelSite, key.hasCrossSiteAncestor]);
  // Once Chrome proves the current partition, a different complete key is out
  // of scope. An empty observation cannot establish that distinction.
  return { kind: currentKeys?.has(identity) ? 'current' : currentKeys?.size ? 'other' : currentKeys ? 'unknown' : 'potential',
    identity, key: { topLevelSite: key.topLevelSite, hasCrossSiteAncestor: key.hasCrossSiteAncestor } };
}

function cookieArray(response) {
  if (!Array.isArray(response?.cookies)) {
    throw failure('INVALID_COOKIE_RESPONSE', 'Chrome did not return a cookie inventory.');
  }
  return response.cookies;
}

function partitionProbeUrls(response, scope) {
  const urls = new Set();
  for (const cookie of cookieArray(response)) {
    if (!cookie || !domainMatches(scope.hostname, cookie.domain) || partition(cookie, scope).kind !== 'potential' ||
        typeof cookie.path !== 'string' || !cookie.path.startsWith('/')) continue;
    // Assigning pathname preserves the initial scheme, host and port even for a
    // cookie path beginning with // or containing URL metacharacters.
    const url = new URL(scope.origin);
    url.pathname = cookie.path;
    urls.add(url.href);
    if (urls.size >= MAX_DELETIONS) break;
  }
  return [...urls];
}

function observedPartitionKeys(response, scope) {
  const keys = new Set();
  for (const cookie of cookieArray(response)) {
    if (!cookie || !domainMatches(scope.hostname, cookie.domain)) continue;
    const key = partition(cookie, scope);
    if (key.kind === 'potential') keys.add(key.identity);
  }
  return keys;
}

function selectCookies(response, scope, currentKeys) {
  const selected = new Map();
  const skipped = { otherPartitions: 0, unknownPartitions: 0, invalidCookies: 0 };
  for (const cookie of cookieArray(response)) {
    if (!cookie || !domainMatches(scope.hostname, cookie.domain)) continue;
    const key = partition(cookie, scope, currentKeys);
    if (key.kind === 'unknown') { skipped.unknownPartitions++; continue; }
    if (key.kind === 'other') { skipped.otherPartitions++; continue; }
    if (typeof cookie.name !== 'string' || typeof cookie.path !== 'string' || !cookie.path.startsWith('/')) {
      skipped.invalidCookies++; continue;
    }
    const params = { name: cookie.name, domain: cookie.domain, path: cookie.path };
    if (key.kind === 'current') params.partitionKey = key.key;
    // Values never form part of an identity: a website may replace a cookie while
    // deletion is running. Such a cookie must still be counted as remaining.
    const identity = JSON.stringify([params.name, params.domain, params.path,
      key.kind === 'current' ? [key.key.topLevelSite, key.key.hasCrossSiteAncestor] : null]);
    selected.set(identity, { identity, params, httpOnly: cookie.httpOnly === true });
  }
  return { selected, skipped };
}

function publicError(error, phase) {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code) ? error.code : 'COOKIE_COMMAND_FAILED';
  // Do not echo raw CDP errors: some implementations include entire responses.
  return { code, phase, message: 'Cookie clearing stopped. Inspect the result before deciding whether to retry; the page may have changed or Chrome may have rejected a command.' };
}

/** Clear the attached top-level site's cookies without executing page JavaScript.
 * send and assertCurrent must be bound to one authorized tab/document session.
 * chromeMajor must come from the extension or browser connection, never the page.
 */
export async function clearCookies({ send, assertCurrent, chromeMajor, timeoutMs = OPERATION_TIMEOUT_MS }) {
  if (typeof send !== 'function' || typeof assertCurrent !== 'function') throw new TypeError('A bound CDP sender and document guard are required.');
  // Chrome 120's DeleteCookies did not filter partition keys. On current Chrome,
  // FilterCookies requires partition presence and all key attributes to match:
  // https://chromium.googlesource.com/chromium/src/+/main/content/browser/devtools/protocol/network_handler.cc
  // Keep a conservative floor even if no partitioned cookie was observed: another
  // page could create one between enumeration and deletion.
  if (!Number.isInteger(chromeMajor) || chromeMajor < MIN_CHROME_MAJOR) {
    throw failure('UNSUPPORTED_COOKIE_ISOLATION', 'Scoped cookie clearing requires a verified Chrome 138 or newer connection.');
  }
  const duration = Number.isFinite(timeoutMs) ? Math.max(1, Math.min(OPERATION_TIMEOUT_MS, timeoutMs)) : OPERATION_TIMEOUT_MS;
  const deadline = Date.now() + duration;
  const deletionDeadline = deadline - Math.min(10_000, Math.floor(duration / 3));
  const result = {
    status: 'unverified', scope: null, matchedCount: null, attemptedCount: 0, deletedCount: null, remainingCount: null,
    httpOnly: { matched: null, attempted: 0, confirmedAbsent: null, remaining: null },
    skippedPartitionedCount: 0, skipped: { otherPartitions: 0, unknownPartitions: 0, invalidCookies: 0 },
    verified: false, stopped: false,
  };
  const command = async (method, params = {}, attemptedCookie) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw failure('COOKIE_CLEAR_TIMEOUT', 'Cookie clearing reached its time limit.');
    let timer;
    try {
      return await Promise.race([
        (async () => {
          await assertCurrent();
          if (Date.now() >= deadline) throw failure('COOKIE_CLEAR_TIMEOUT', 'Cookie clearing reached its time limit.');
          if (attemptedCookie) {
            result.attemptedCount++;
            if (attemptedCookie.httpOnly) result.httpOnly.attempted++;
          }
          const response = await send(method, params);
          await assertCurrent();
          return response;
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(failure('COOKIE_CLEAR_TIMEOUT', 'Cookie clearing reached its time limit.')), remaining); }),
      ]);
    } finally { clearTimeout(timer); }
  };
  let initial;
  let inventory;
  let currentKeys = new Set();
  let phase = 'scope';
  try {
    initial = getFrame(await command('Page.getFrameTree'));
    result.scope = { hostname: initial.hostname, scheme: initial.scheme, paths: 'all', includesParentDomains: true, partition: 'current_top_level_site_only' };
    phase = 'inventory';
    const cookies = await command('Storage.getCookies');
    const urls = partitionProbeUrls(cookies, initial);
    if (urls.length) {
      phase = 'partition_scope';
      // Chrome derives this command's partition from the attached frame's native
      // NetworkIsolationKey. Host suffixes alone cannot establish a schemeful
      // site, especially for private public suffixes such as github.io.
      currentKeys = observedPartitionKeys(await command('Network.getCookies', { urls }), initial);
    }
    inventory = selectCookies(cookies, initial, currentKeys);
    result.matchedCount = inventory.selected.size;
    result.httpOnly.matched = [...inventory.selected.values()].filter(cookie => cookie.httpOnly).length;
    result.skipped = inventory.skipped;
    result.skippedPartitionedCount = inventory.skipped.otherPartitions + inventory.skipped.unknownPartitions;
    phase = 'scope_check';
    assertFrame(initial, getFrame(await command('Page.getFrameTree')));
  } catch (error) {
    result.stopped = true; result.error = publicError(error, phase);
    return result;
  }

  phase = 'delete';
  for (const cookie of inventory.selected.values()) {
    try {
      // Count only issued commands as attempts; assertCurrent can reject before
      // send begins, and a timed-out issued command can have an unknown outcome.
      if (result.attemptedCount >= MAX_DELETIONS) throw failure('COOKIE_CLEAR_LIMIT', 'Cookie clearing reached its deletion limit.');
      if (Date.now() >= deletionDeadline) throw failure('COOKIE_CLEAR_TIMEOUT', 'Cookie clearing reserved its remaining time for verification.');
      await command('Network.deleteCookies', cookie.params, cookie);
    } catch (error) {
      result.stopped = true; result.error = publicError(error, phase);
      break;
    }
  }

  phase = 'verify';
  try {
    assertFrame(initial, getFrame(await command('Page.getFrameTree')));
    const after = selectCookies(await command('Storage.getCookies'), initial, currentKeys);
    assertFrame(initial, getFrame(await command('Page.getFrameTree')));
    result.verified = true;
    result.remainingCount = after.selected.size;
    result.httpOnly.remaining = [...after.selected.values()].filter(cookie => cookie.httpOnly).length;
    const absent = [...inventory.selected.values()].filter(cookie => !after.selected.has(cookie.identity));
    result.deletedCount = absent.length;
    result.httpOnly.confirmedAbsent = absent.filter(cookie => cookie.httpOnly).length;
    result.skipped = {
      otherPartitions: Math.max(result.skipped.otherPartitions, after.skipped.otherPartitions),
      unknownPartitions: Math.max(result.skipped.unknownPartitions, after.skipped.unknownPartitions),
      invalidCookies: Math.max(result.skipped.invalidCookies, after.skipped.invalidCookies),
    };
    result.skippedPartitionedCount = result.skipped.otherPartitions + result.skipped.unknownPartitions;
    result.status = result.stopped || result.remainingCount || result.skipped.unknownPartitions || result.skipped.invalidCookies ? 'partial' : 'cleared';
  } catch (error) {
    result.stopped = true;
    result.verificationError = publicError(error, phase);
  }
  return result;
}
