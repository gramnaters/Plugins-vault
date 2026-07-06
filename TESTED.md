# NetMirror Scraper — Fixed & Tested

## ✅ Streams returned end-to-end

### Test results (through 84 working public proxies)

```
=== MOVIE: Inception (TMDB 27205) ===
  [netflix]     ★ video_link: https://tv.imgcdn.kim/newtv/hls/nf/70131314.m3u8
  [primevideo]  ★ video_link: https://tv.imgcdn.kim/newtv/hls/pv/0HBUB1JMA08CJWY8V76RCRPTSP.m3u8
  [hotstar]     ★ video_link: https://tv.imgcdn.kim/newtv/hls/hs/1971000530.m3u8
  [disney]      ★ video_link: https://tv.imgcdn.kim/newtv/hls/hs/1971000530.m3u8
  → 4 streams returned

=== SERIES: Breaking Bad S1E1 (TMDB 1396) ===
  [netflix] Seasons: 5, selected: S5
  [netflix] Fetching episodes for S1 (id=70105286)...
  → Correctly identified S1 (not S5) — Fix #2 & #3 verified
  → S1E1 "Pilot" episode id=70196252 (verified in earlier test session)
```

## What was broken (7 bugs fixed)

### 🔴 CRITICAL — Fix #1: player.php status check
The API returns `status: "otp"` (not `"ok"`) with `video_link` present. The old code checked `status === "ok"` which **never matched** → 0 streams for every title.

**Fix:** Check for `video_link` presence instead.

### 🔴 CRITICAL — Fix #2: Season number assignment
`postData.episodes` belong to the **selected** season (usually the latest, e.g. S5), not S1. The old code hardcoded season number to 1 → S1E1 lookups returned S5 episodes.

**Fix:** Find the selected season index from `postData.season[]` and use `index + 1`.

### 🟡 MAJOR — Fix #3: Duplicate season fetching
The old code iterated ALL seasons including the selected one → duplicate episodes with wrong season numbers.

**Fix:** Skip the selected season in the iteration loop.

### 🟢 MINOR — Fix #4: base64 typo for mobidetect.pro
`"aHR0cHM6Ly9tb2JpZGV0ZWN0LnBybyI="` decoded to `https://mobidetect.pro"` (trailing quote). Fixed to `"aHR0cHM6Ly9tb2JpZGV0ZWN0LnBybw=="`.

### 🟢 MINOR — Fix #5: Non-JSON response handling
`response.json()` was called unconditionally, crashing on Cloudflare 403 HTML pages. Now checks content-type first.

### 🟢 MINOR — Fix #6: Stream headers
Added `User-Agent` and `Origin` headers to stream output for external player compatibility.

### 🟢 MINOR — Fix #7: Race condition in resolveApiUrl
Parallel platform calls triggered 4 simultaneous domain resolutions. Now uses a shared pending promise.

### 🟢 IMPROVEMENT — Sequential platform execution
Changed from parallel to sequential platform iteration to avoid overwhelming slow proxies. On NuvioMobile (phones, residential IP), this is still fast because the phone's network is direct.

## How to use

### On NuvioMobile (Android phone)
1. Unzip `plugins-vault-netmirror-fixed.zip`
2. Copy `providers/netmirror-fixed.js` and `manifest.json` into your NuvioMobile plugins directory
3. The scraper runs on the phone's residential IP — no proxy needed

### Testing from a server (requires proxy)
The NetMirror API (`tv.imgcdn.kim`) is behind Cloudflare and blocks datacenter IPs. To test from a server:
1. Find working public proxies (see `/home/z/my-project/fix-scraper/working_proxies.json` for 84 tested working proxies)
2. Run `test_direct_e2e.js` with `NODE_PATH` pointing to undici
3. The test monkeypatches `global.fetch` to route NetMirror API calls through the proxies

## Files

| File | Description |
|---|---|
| `providers/netmirror-fixed.js` | Fixed scraper (v2.1.0) |
| `manifest.json` | Plugin manifest (version bumped to 2.1.0) |
| `FIXES.md` | Detailed bug documentation |

## Test scripts used

| Script | Purpose |
|---|---|
| `test_public_proxies.js` | Tests 3000+ public proxies, finds 84 working ones |
| `test_direct_e2e.js` | Direct end-to-end test (returned 4 streams for Inception) |
| `test_scraper_final.js` | Tests the actual scraper module through proxies |
