/**
 * NetMirror Scraper - FIXED VERSION
 * Dynamic domain resolution with multiple fallback endpoints
 * Supports Netflix, Prime Video, Hotstar, Disney+
 *
 * FIXES APPLIED (vs original by gramnaters):
 *   1. CRITICAL: player.php status check — API returns "otp" not "ok",
 *      but video_link is present in both cases. Now checks video_link
 *      presence instead of status === "ok".
 *   2. CRITICAL: Season number assignment — postData.episodes belong to
 *      the SELECTED season (often S5), not always S1. Now uses the
 *      selected season index from postData.season[].
 *   3. MAJOR: Skip the selected season when iterating postData.season
 *      to avoid duplicate episode fetching and wrong season numbers.
 *   4. MINOR: Fixed base64 typo for mobidetect.pro (had trailing quote).
 *   5. MINOR: fetchWithTimeout now handles non-JSON responses gracefully
 *      (e.g. Cloudflare 403 HTML) instead of throwing parse errors.
 *   6. MINOR: Added User-Agent + Origin to stream headers for better
 *      external player compatibility.
 *   7. MINOR: Race condition in resolveApiUrl — multiple parallel calls
 *      no longer trigger redundant domain resolution.
 */

console.log('[NetMirror] Initializing NetMirror provider (fixed v2.1.0)');

const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";

// Dynamic domain pool (base64 encoded, rotates if one fails)
const DOMAIN_POOL = [
    "aHR0cHM6Ly9tb2JpbGVkZXRlY3RzLmNvbQ==",        // mobiledetects.com
    "aHR0cHM6Ly9tb2JpbGVkZXRlY3QuYXBw",           // mobiledetect.app
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LmFydA==",           // mobidetect.art
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LmNj",               // mobidetect.cc
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LmNsaWNr",          // mobidetect.click
    "aHR0cHM6Ly9tb2JpZGV0ZWN0Lmluaw==",          // mobidetect.ink
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LmxpdmU=",          // mobidetect.live
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LnBybw==",          // mobidetect.pro  (FIXED: was "byI=" with trailing quote)
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNob3A=",          // mobidetect.shop
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNpdGU=",          // mobidetect.site
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNwYWNl",         // mobidetect.space
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LnN0b3Jl",         // mobidetect.store
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LnZpcA==",         // mobidetect.vip
    "aHR0cHM6Ly9tb2JpZGV0ZWN0Lndpa2k=",         // mobidetect.wiki
    "aHR0cHM6Ly9tb2JpZGV0ZWN0Lnh5eg==",         // mobidetect.xyz
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5hcnQ=",         // mobidetects.art
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5jYw==",         // mobidetects.cc
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5pbmZv",        // mobidetects.info
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5pbms=",        // mobidetects.ink
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5saXZl",       // mobidetects.live
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5wcm8=",       // mobidetects.pro
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5zdG9yZQ==",   // mobidetects.store
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy50b3A=",       // mobidetects.top
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy54eXo="        // mobidetects.xyz
];

const PLATFORM_MAP = {
    netflix: { ott: "nf" },
    primevideo: { ott: "pv" },
    hotstar: { ott: "hs" },
    disney: { ott: "hs" }
};

const NEW_TV_BASE_HEADERS = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
    "X-Requested-With": "NetmirrorNewTV v1.0",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0",
    "Accept": "application/json, text/plain, */*"
};

// Stream playback headers — sent to the video player
const STREAM_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

let resolvedApiUrl = null;
let apiResolutionTimestamp = 0;
const API_CACHE_EXPIRY = 3600000; // 1 hour

// FIX #7: Pending promise to prevent race conditions in parallel resolveApiUrl calls
let resolveApiUrlPromise = null;

// Base64 decode
function safeAtob(encoded) {
    try {
        if (typeof atob === "function") {
            return atob(encoded);
        }
        // Fallback for Node.js / QuickJS without atob
        if (typeof Buffer !== "undefined") {
            return Buffer.from(encoded, "base64").toString("binary");
        }
        throw new Error("No base64 decoder available");
    } catch (e) {
        console.error('[NetMirror] Base64 decode error:', e.message);
        return null;
    }
}

// Resolve the actual API URL from dynamic domains
// FIX #7: Returns a shared promise if resolution is already in progress
function resolveApiUrl() {
    // Check cache
    const now = Date.now();
    if (resolvedApiUrl && apiResolutionTimestamp && (now - apiResolutionTimestamp) < API_CACHE_EXPIRY) {
        return Promise.resolve(resolvedApiUrl);
    }
    // If resolution is already in flight, return the same promise
    if (resolveApiUrlPromise) {
        return resolveApiUrlPromise;
    }

    console.log('[NetMirror] Resolving API URL from domains...');
    resolveApiUrlPromise = new Promise(function(resolve, reject) {
        let domainIndex = 0;

        function tryNextDomain() {
            if (domainIndex >= DOMAIN_POOL.length) {
                console.error('[NetMirror] All domains exhausted, could not resolve API');
                resolveApiUrlPromise = null;
                return reject(new Error("Failed to resolve API URL from any domain"));
            }

            const encoded = DOMAIN_POOL[domainIndex];
            const base = safeAtob(encoded);

            if (!base) {
                domainIndex++;
                return tryNextDomain();
            }

            const domain = base.replace(/\/$/, "");
            const checkUrl = domain + "/checknewtv.php";

            console.log('[NetMirror] Trying domain:', domain.replace(/^https:\/\//, ''));

            fetch(checkUrl, {
                method: 'GET',
                headers: NEW_TV_BASE_HEADERS
            }).then(function(response) {
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }
                return response.json();
            }).then(function(data) {
                if (data && data.token_hash) {
                    const decodedUrl = safeAtob(data.token_hash);
                    if (decodedUrl) {
                        resolvedApiUrl = decodedUrl.replace(/\/$/, "");
                        apiResolutionTimestamp = Date.now();
                        console.log('[NetMirror] API URL resolved:', resolvedApiUrl.replace(/^https:\/\//, ''));
                        resolveApiUrlPromise = null;
                        return resolve(resolvedApiUrl);
                    }
                }
                throw new Error("No token_hash in response");
            }).catch(function(error) {
                console.log('[NetMirror] Domain failed:', error.message);
                domainIndex++;
                tryNextDomain();
            });
        }

        tryNextDomain();
    });

    return resolveApiUrlPromise;
}

// Build headers with OTT identifier
function buildHeaders(ott, extra) {
    extra = extra || {};
    const headers = {};
    for (const key in NEW_TV_BASE_HEADERS) {
        headers[key] = NEW_TV_BASE_HEADERS[key];
    }
    headers["Ott"] = ott;
    for (const key in extra) {
        headers[key] = extra[key];
    }
    return headers;
}

// FIX #5: Fetch with timeout + graceful non-JSON handling
function fetchWithTimeout(url, options) {
    options = options || {};
    var timeoutMs = options.timeout || 15000;

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeoutId = controller ? setTimeout(function() {
        controller.abort();
    }, timeoutMs) : null;

    var fetchOptions = {
        method: options.method || 'GET',
        headers: options.headers || {}
    };

    if (controller) {
        fetchOptions.signal = controller.signal;
    }

    return fetch(url, fetchOptions).then(function(response) {
        if (timeoutId) clearTimeout(timeoutId);
        // FIX: Don't auto-parse JSON — check content-type first
        var ct = response.headers.get('content-type') || '';
        if (response.ok && ct.indexOf('application/json') !== -1) {
            return response.json().then(function(data) {
                return { ok: true, data: data, status: response.status };
            });
        }
        // Non-JSON or non-OK — return text so caller can decide
        return response.text().then(function(text) {
            return { ok: response.ok, data: null, status: response.status, text: text };
        });
    }).catch(function(error) {
        if (timeoutId) clearTimeout(timeoutId);
        console.error('[NetMirror] Fetch error:', error.message);
        throw error;
    });
}

// FIX #2 & #3: Get all episodes with correct season numbers
// - postData.episodes belong to the SELECTED season (find its index, not always S1)
// - Skip the selected season when iterating postData.season (avoid duplicates)
function getAllEpisodes(contentId, postData, platform, apiBase) {
    return new Promise(function(resolve) {
        var episodes = [];

        // Process a list of episode objects into {id, s, ep}
        function processEpisodes(episodeList, seasonNum) {
            if (!episodeList) return;
            for (var i = 0; i < episodeList.length; i++) {
                var ep = episodeList[i];
                if (!ep) continue;

                var epNum = null;
                if (ep.ep) {
                    epNum = parseInt(ep.ep);
                } else if (ep.epNum) {
                    epNum = parseInt(ep.epNum.toString().replace(/[SE]/g, ""));
                }

                if (epNum !== null && !isNaN(epNum)) {
                    episodes.push({
                        id: ep.id,
                        s: seasonNum,
                        ep: epNum
                    });
                }
            }
        }

        // FIX #2: Find the selected season index — postData.episodes belong to it
        var selectedSeasonIdx = -1;
        var selectedSeasonNum = 1;
        if (postData.season && postData.season.length > 0) {
            for (var i = 0; i < postData.season.length; i++) {
                if (postData.season[i] && postData.season[i].selected) {
                    selectedSeasonIdx = i;
                    selectedSeasonNum = i + 1; // season number is 1-indexed
                    break;
                }
            }
        }

        // Process postData.episodes with the SELECTED season number (not hardcoded 1)
        if (postData.episodes) {
            processEpisodes(postData.episodes, selectedSeasonNum);
        }

        // FIX #3: Iterate remaining seasons (skip the selected one to avoid duplicates)
        if (postData.season && postData.season.length > 0) {
            var seasonsToFetch = [];
            for (var j = 0; j < postData.season.length; j++) {
                if (j === selectedSeasonIdx) continue; // skip selected
                if (!postData.season[j] || !postData.season[j].id) continue;
                seasonsToFetch.push({ season: postData.season[j], idx: j });
            }

            if (seasonsToFetch.length === 0) {
                return resolve(episodes);
            }

            var seasonsProcessed = 0;
            var totalSeasons = seasonsToFetch.length;

            seasonsToFetch.forEach(function(item) {
                var url = apiBase + "/newtv/episodes.php?id=" + item.season.id + "&page=1";
                fetchWithTimeout(url, {
                    headers: buildHeaders(platform.ott)
                }).then(function(response) {
                    if (response.ok && response.data && response.data.episodes) {
                        processEpisodes(response.data.episodes, item.idx + 1);
                    }
                    seasonsProcessed++;
                    if (seasonsProcessed === totalSeasons) {
                        resolve(episodes);
                    }
                }).catch(function(error) {
                    seasonsProcessed++;
                    if (seasonsProcessed === totalSeasons) {
                        resolve(episodes);
                    }
                });
            });
        } else {
            resolve(episodes);
        }
    });
}

// Fetch streams from a platform
function fetchFromPlatform(platformKey, title, mediaType, season, episode) {
    return new Promise(function(resolve) {
        resolveApiUrl().then(function(apiBase) {
            var platform = PLATFORM_MAP[platformKey];
            var searchUrl = apiBase + "/newtv/search.php?s=" + encodeURIComponent(title);

            console.log('[NetMirror] Searching ' + platformKey + ' for: ' + title);

            return fetchWithTimeout(searchUrl, {
                headers: buildHeaders(platform.ott)
            }).then(function(response) {
                if (!response.ok || !response.data || !response.data.searchResult || response.data.searchResult.length === 0) {
                    console.log('[NetMirror] No results on ' + platformKey);
                    return resolve(null);
                }

                // FIX: Prefer exact title match (case-insensitive) to avoid wrong hits
                var match = null;
                var lowerTitle = title.toLowerCase();
                for (var i = 0; i < response.data.searchResult.length; i++) {
                    var r = response.data.searchResult[i];
                    if (r && r.t && r.t.trim().toLowerCase() === lowerTitle) {
                        match = r;
                        break;
                    }
                }
                if (!match) match = response.data.searchResult[0];

                var contentId = match.id;

                var postUrl = apiBase + "/newtv/post.php?id=" + contentId;
                return fetchWithTimeout(postUrl, {
                    headers: buildHeaders(platform.ott, { Lastep: "", Usertoken: "" })
                }).then(function(postResponse) {
                    if (!postResponse.ok || !postResponse.data) {
                        return resolve(null);
                    }
                    var postData = postResponse.data;
                    var targetId = contentId;

                    if (mediaType === "tv") {
                        // Skip if it's actually a movie (no seasons/episodes)
                        if (postData.type !== "t" && (!postData.episodes || postData.episodes.filter(function(e){return e;}).length === 0)) {
                            console.log('[NetMirror] ' + platformKey + ' hit is a movie, not series');
                            return resolve(null);
                        }

                        return getAllEpisodes(contentId, postData, platform, apiBase).then(function(allEpisodes) {
                            var wantedS = parseInt(season);
                            var wantedE = parseInt(episode);
                            var targetEp = null;
                            for (var k = 0; k < allEpisodes.length; k++) {
                                if (allEpisodes[k] && allEpisodes[k].s === wantedS && allEpisodes[k].ep === wantedE) {
                                    targetEp = allEpisodes[k];
                                    break;
                                }
                            }

                            if (!targetEp) {
                                console.log('[NetMirror] Episode S' + season + 'E' + episode + ' not found on ' + platformKey);
                                return resolve(null);
                            }

                            targetId = targetEp.id;
                            return fetchPlayerAndBuildStream(apiBase, platform, platformKey, targetId, title, season, episode);
                        });
                    } else {
                        // Movie — skip if it's actually a series
                        if (postData.type === "t" || (postData.episodes && postData.episodes.filter(function(e){return e;}).length > 0)) {
                            console.log('[NetMirror] ' + platformKey + ' hit is a series, not movie');
                            return resolve(null);
                        }

                        targetId = postData.main_id || contentId;
                        return fetchPlayerAndBuildStream(apiBase, platform, platformKey, targetId, title, null, null);
                    }
                });
            });
        }).catch(function(error) {
            console.error('[NetMirror] Platform fetch error (' + platformKey + '):', error.message);
            resolve(null);
        });
    });
}

// FIX #1: Accept status "ok" OR "otp" — video_link is present in both cases
// FIX #6: Include User-Agent + Origin in stream headers
function fetchPlayerAndBuildStream(apiBase, platform, platformKey, targetId, title, season, episode) {
    var playerUrl = apiBase + "/newtv/player.php?id=" + targetId;
    return fetchWithTimeout(playerUrl, {
        headers: buildHeaders(platform.ott, { "Usertoken": "" })
    }).then(function(playerResponse) {
        if (!playerResponse.ok || !playerResponse.data) {
            return null;
        }
        var d = playerResponse.data;
        // FIX #1: The API returns status: "otp" with video_link present.
        // The original code checked status === "ok" which NEVER matched.
        // Now we accept either status as long as video_link is present.
        if (d.video_link) {
            var nameLabel = platformKey.charAt(0).toUpperCase() + platformKey.slice(1);
            var streamTitle = title;
            if (season !== null && episode !== null) {
                streamTitle = title + ' · S' + season + 'E' + episode;
            }
            return [{
                name: "NetMirror (" + nameLabel + ")",
                title: streamTitle,
                url: d.video_link,
                quality: "Auto",
                headers: {
                    "Referer": d.referer || "https://net52.cc",
                    "User-Agent": STREAM_USER_AGENT,
                    "Origin": "https://net52.cc"
                }
            }];
        }
        return null;
    });
}

// Main function: Get streams
function getStreams(tmdbId, mediaType, season, episode) {
    return new Promise(function(resolve) {
        season = season || 1;
        episode = episode || 1;

        // Get title from TMDB
        var tmdbType = mediaType === "tv" ? "tv" : "movie";
        var tmdbUrl = "https://api.themoviedb.org/3/" + tmdbType + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;

        console.log('[NetMirror] Fetching ' + mediaType + ' info from TMDB (ID: ' + tmdbId + ')');

        fetch(tmdbUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/json"
            }
        }).then(function(response) {
            return response.json();
        }).then(function(tmdbData) {
            var title = mediaType === "tv" ? tmdbData.name : tmdbData.title;

            if (!title) {
                console.error('[NetMirror] Could not fetch title from TMDB');
                return resolve([]);
            }

            console.log('[NetMirror] Found title: ' + title);

            var platforms = ["netflix", "primevideo", "hotstar", "disney"];
            var foundStreams = [];

            // Run platforms SEQUENTIALLY to avoid overwhelming slow proxies.
            // On NuvioMobile (phones, residential IP) this is still fast because
            // the phone's network is direct — no proxy overhead.
            (async function() {
                for (var pi = 0; pi < platforms.length; pi++) {
                    var platformKey = platforms[pi];
                    try {
                        var streams = await fetchFromPlatform(platformKey, title, mediaType, season, episode);
                        if (streams && streams.length > 0) {
                            console.log('[NetMirror] Found ' + streams.length + ' streams on ' + platformKey);
                            foundStreams = foundStreams.concat(streams);
                        }
                    } catch (error) {
                        console.error('[NetMirror] Error on ' + platformKey + ':', error.message);
                    }
                }
                console.log('[NetMirror] Total streams found: ' + foundStreams.length);
                resolve(foundStreams);
            })();

        }).catch(function(error) {
            console.error('[NetMirror] TMDB fetch error:', error.message);
            resolve([]);
        });
    });
}

module.exports = { getStreams };
