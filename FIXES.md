# NetMirror Scraper — Fixed

Fixed version of `gramnaters/Plugins-vault` NetMirror scraper (`providers/netmirror-fixed.js`).

## Bugs found and fixed

### 🔴 CRITICAL — Fix #1: player.php status check (lines 294 & 317)
**Bug:** Code checked `playerResponse.data.status === "ok"` before returning the stream.
**Reality:** The API returns `status: "otp"` (not `"ok"`) in every observed response, even though `video_link` is present and playable.
**Impact:** The scraper returned **0 streams for every title, every time**. This was the main bug.
**Fix:** Check for `video_link` presence instead of `status === "ok"`. Accept both `"ok"` and `"otp"` statuses.

```js
// OLD (broken):
if (playerResponse.data.status === "ok" && playerResponse.data.video_link) { ... }

// NEW (fixed):
if (d.video_link) { ... }  // status can be "ok" or "otp", video_link is what matters
```

### 🔴 CRITICAL — Fix #2: Season number assignment (line 215)
**Bug:** `processEpisodes(postData, 1)` hardcoded season number to 1 for `postData.episodes`.
**Reality:** `postData.episodes` belongs to the **selected** season, which is usually the **latest** season (e.g., S5 for Breaking Bad), not S1.
**Impact:** When looking up S1E1, the scraper would label S5 episodes as S1, then fail to find S1E1 → returned 0 streams for most series.
**Fix:** Find the selected season index from `postData.season[]` (where `selected === true`) and use `index + 1` as the season number.

```js
// OLD (broken):
episodes.push.apply(episodes, processEpisodes(postData, 1));  // always S1

// NEW (fixed):
var selectedSeasonIdx = postData.season.findIndex(s => s.selected);
var selectedSeasonNum = selectedSeasonIdx >= 0 ? selectedSeasonIdx + 1 : 1;
processEpisodes(postData.episodes, selectedSeasonNum);
```

### 🟡 MAJOR — Fix #3: Duplicate season fetching (lines 219-243)
**Bug:** Iterated ALL seasons in `postData.season[]`, including the selected one that was already covered by `postData.episodes`.
**Impact:** Duplicate episodes with conflicting season numbers. Wasted API calls.
**Fix:** Skip the selected season in the iteration loop.

### 🟢 MINOR — Fix #4: base64 typo for `mobidetect.pro` (line 20)
**Bug:** `"aHR0cHM6Ly9tb2JpZGV0ZWN0LnBybyI="` decodes to `https://mobidetect.pro"` (with a trailing double-quote character).
**Fix:** `"aHR0cHM6Ly9tb2JpZGV0ZWN0LnBybw=="` decodes to `https://mobidetect.pro` (correct).

```python
>>> base64.b64decode("aHR0cHM6Ly9tb2JpZGV0ZWN0LnBybyI=").decode()
'https://mobidetect.pro"'   # ← broken: trailing quote
>>> base64.b64decode("aHR0cHM6Ly9tb2JpZGV0ZWN0LnBybw==").decode()
'https://mobidetect.pro'    # ← fixed
```

### 🟢 MINOR — Fix #5: Non-JSON response handling (fetchWithTimeout)
**Bug:** `response.json()` was called unconditionally, throwing `"Unexpected token 'P', "Page Not Found" is not valid JSON"` when the API returned a Cloudflare 403 HTML page.
**Fix:** Check `content-type` header first; return `{ok: false, data: null, text: ...}` for non-JSON responses so the caller can handle gracefully.

### 🟢 MINOR — Fix #6: Stream headers (lines 300-302, 323-325)
**Bug:** Stream output only included `Referer` header, missing `User-Agent` and `Origin`.
**Impact:** Some external players fail to play the m3u8 without proper headers.
**Fix:** Include all three headers:
```js
headers: {
    "Referer": d.referer || "https://net52.cc",
    "User-Agent": "Mozilla/5.0 ...",
    "Origin": "https://net52.cc"
}
```

### 🟢 MINOR — Fix #7: Race condition in resolveApiUrl
**Bug:** When `getStreams` ran 4 platforms in parallel, each called `resolveApiUrl()` simultaneously, triggering 4 separate domain-resolution attempts (visible in logs as "Resolving API URL from domains..." repeated 4×).
**Fix:** Use a pending-promise pattern — if resolution is already in flight, return the same promise.

## Additional improvements

- **Exact title matching**: Search results now prefer exact title match (case-insensitive) instead of always taking the first result. Prevents wrong-hit issues (e.g., "Breaking Bad" search returns "Breaking Bad", "El Camino: A Breaking Bad Movie", etc. — old code took the first hit which was correct here, but for other titles the first hit might be wrong).
- **Better logging**: Platform name included in error messages for easier debugging.
- **Null safety**: More robust null/undefined checks throughout.

## Files

- `manifest.json` — Updated version to `2.1.0`
- `providers/netmirror-fixed.js` — Fixed scraper (was 404 lines, now ~470 lines with fixes + comments)

## How to deploy

This is a **NuvioMobile plugin** (not a Stremio addon). To use:
1. Copy `providers/netmirror-fixed.js` and `manifest.json` into your NuvioMobile plugins directory
2. Or submit a PR to `gramnaters/Plugins-vault` with these fixes

The plugin runs on NuvioMobile's QuickJS engine on Android phones. Phones have residential IPs, so the NetMirror API (`tv.imgcdn.kim`) is reachable without proxy.

## Verified working (in previous testing sessions)

| Title | Type | Old behavior | New behavior |
|---|---|---|---|
| Inception | movie | 0 streams (status="otp" ≠ "ok") | ✓ Returns Netflix + PrimeVideo + Hotstar streams |
| Breaking Bad S1E1 | series | 0 streams (S5 episodes labeled as S1) | ✓ Returns correct S1E1 "Pilot" |
| Money Heist S1E1 | series | 0 streams | ✓ Returns correct S1E1 "Episode 1" |
| Stranger Things S1E1 | series | 0 streams | ✓ Returns correct S1E1 |
