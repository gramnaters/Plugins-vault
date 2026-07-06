/**
 * NetMirror Scraper - FIXED VERSION
 * Stream movies and TV shows from Netflix, Prime Video, Hotstar, and Disney+
 * via NetMirror API with dynamic domain rotation.
 *
 * This version matches the yoruix scraper pattern (confirmed working in NuvioMobile):
 *   - Uses fetch() and response.json() directly (no fetchWithTimeout wrapper)
 *   - No AbortController (NuvioMobile's fetch is synchronous via __native_fetch)
 *   - Simple cached resolveApiUrl (no shared promise pattern)
 *
 * BUG FIXES vs original gramnaters version:
 *   1. CRITICAL: player.php returns status="otp" not "ok", but video_link is
 *      present. Now checks video_link instead of status === "ok".
 *   2. CRITICAL: postData.episodes belong to SELECTED season (often S5), not
 *      always S1. Now uses selected season index from postData.season[].
 *   3. MAJOR: Skip selected season when iterating to avoid duplicate episodes.
 *   4. MINOR: Fixed base64 typo for mobidetect.pro (had trailing quote).
 *   5. MINOR: Added User-Agent + Origin to stream headers for player compatibility.
 */

console.log('[NetMirror] Initializing NetMirror provider (fixed v2.2.0)');

var TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";

// Dynamic domain pool (base64 encoded, rotates if one fails)
var DOMAIN_POOL = [
    "aHR0cHM6Ly9tb2JpbGVkZXRlY3RzLmNvbQ==",
    "aHR0cHM6Ly9tb2JpbGVkZXRlY3QuYXBw",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LmFydA==",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LmNj",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LmNsaWNr",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0Lmluaw==",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LmxpdmU=",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LnBybw==",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNob3A=",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNpdGU=",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNwYWNl",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LnN0b3Jl",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0LnZpcA==",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0Lndpa2k=",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0Lnh5eg==",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5hcnQ=",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5jYw==",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5pbmZv",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5pbms=",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5saXZl",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5wcm8=",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5zdG9yZQ==",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy50b3A=",
    "aHR0cHM6Ly9tb2JpZGV0ZWN0cy54eXo="
];

var PLATFORM_MAP = {
    netflix: { ott: "nf" },
    primevideo: { ott: "pv" },
    hotstar: { ott: "hs" },
    disney: { ott: "hs" }
};

var NEW_TV_BASE_HEADERS = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
    "X-Requested-With": "NetmirrorNewTV v1.0",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0",
    "Accept": "application/json, text/plain, */*"
};

var STREAM_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

var resolvedApiUrl = null;
var apiResolutionTimestamp = 0;
var API_CACHE_EXPIRY = 3600000;

function safeAtob(encoded) {
    try {
        if (typeof atob === "function") {
            return atob(encoded);
        }
        if (typeof Buffer !== "undefined") {
            return Buffer.from(encoded, "base64").toString("binary");
        }
        return null;
    } catch (e) {
        return null;
    }
}

// Resolve the actual API URL from dynamic domains
function resolveApiUrl() {
    return new Promise(function(resolve, reject) {
        var now = Date.now();
        if (resolvedApiUrl && apiResolutionTimestamp && (now - apiResolutionTimestamp) < API_CACHE_EXPIRY) {
            return resolve(resolvedApiUrl);
        }

        var domainIndex = 0;

        function tryNextDomain() {
            if (domainIndex >= DOMAIN_POOL.length) {
                return reject(new Error("Failed to resolve API URL"));
            }

            var encoded = DOMAIN_POOL[domainIndex];
            var base = safeAtob(encoded);

            if (!base) {
                domainIndex++;
                return tryNextDomain();
            }

            var domain = base.replace(/\/$/, "");
            var checkUrl = domain + "/checknewtv.php";

            console.log('[NetMirror] Trying domain:', domain.replace(/^https:\/\//, ''));

            fetch(checkUrl, {
                method: 'GET',
                headers: NEW_TV_BASE_HEADERS
            }).then(function(response) {
                return response.json();
            }).then(function(data) {
                if (data && data.token_hash) {
                    var decodedUrl = safeAtob(data.token_hash);
                    if (decodedUrl) {
                        resolvedApiUrl = decodedUrl.replace(/\/$/, "");
                        apiResolutionTimestamp = Date.now();
                        console.log('[NetMirror] API URL resolved:', resolvedApiUrl);
                        return resolve(resolvedApiUrl);
                    }
                }
                domainIndex++;
                tryNextDomain();
            }).catch(function(error) {
                domainIndex++;
                tryNextDomain();
            });
        }

        tryNextDomain();
    });
}

function buildHeaders(ott, extra) {
    extra = extra || {};
    var headers = {};
    for (var key in NEW_TV_BASE_HEADERS) {
        headers[key] = NEW_TV_BASE_HEADERS[key];
    }
    headers["Ott"] = ott;
    for (var key in extra) {
        headers[key] = extra[key];
    }
    return headers;
}

// Get all episodes for a TV show
// FIX #2: Use selected season index for postData.episodes (not hardcoded S1)
// FIX #3: Skip selected season when iterating to avoid duplicates
function getAllEpisodes(contentId, postData, platform, apiBase) {
    return new Promise(function(resolve) {
        var episodes = [];

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

        // FIX #2: Find the selected season index
        var selectedSeasonIdx = -1;
        var selectedSeasonNum = 1;
        if (postData.season && postData.season.length > 0) {
            for (var i = 0; i < postData.season.length; i++) {
                if (postData.season[i] && postData.season[i].selected) {
                    selectedSeasonIdx = i;
                    selectedSeasonNum = i + 1;
                    break;
                }
            }
        }

        // Process postData.episodes with the SELECTED season number
        if (postData.episodes) {
            processEpisodes(postData.episodes, selectedSeasonNum);
        }

        // FIX #3: Iterate remaining seasons (skip selected to avoid duplicates)
        if (postData.season && postData.season.length > 0) {
            var seasonsToFetch = [];
            for (var j = 0; j < postData.season.length; j++) {
                if (j === selectedSeasonIdx) continue;
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
                fetch(url, {
                    method: 'GET',
                    headers: buildHeaders(platform.ott)
                }).then(function(response) {
                    return response.json();
                }).then(function(data) {
                    if (data && data.episodes) {
                        processEpisodes(data.episodes, item.idx + 1);
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

// FIX #1: Accept video_link presence (not status === "ok")
// FIX #6: Include User-Agent + Origin in stream headers
// FIX #8: Parse master m3u8, keep only 480p to avoid video CDN rate limiting.
//   The video CDN (s21.freecdn4.top) returns 429 after ~50-100 rapid segment
//   requests. 480p segments are smaller â†’ less bandwidth â†’ less rate limiting.
//   We preserve audio + subtitle tracks so the user still gets multi-audio.
//   Returns a data: URI containing the modified master playlist.
function buildStreamResult(platformKey, title, playerData, season, episode) {
    if (!playerData || !playerData.video_link) {
        return null;
    }
    var nameLabel = platformKey.charAt(0).toUpperCase() + platformKey.slice(1);
    var streamTitle = title;
    if (season !== null && season !== undefined && episode !== null && episode !== undefined) {
        streamTitle = title + ' Â· S' + season + 'E' + episode;
    }

    // Return a stream that uses the original master m3u8 URL.
    // The caller (getStreams) will post-process this to create a data: URI
    // with only 480p quality to avoid video CDN rate limiting.
    return {
        name: "NetMirror (" + nameLabel + ")",
        title: streamTitle,
        url: playerData.video_link,
        quality: "Auto",
        headers: {
            "Referer": playerData.referer || "https://net52.cc",
            "User-Agent": STREAM_USER_AGENT,
            "Origin": "https://net52.cc"
        },
        _referer: playerData.referer || "https://net52.cc"
    };
}

// FIX #8: Fetch master m3u8, strip high qualities (keep 480p only),
// return as data: URI. This prevents the video CDN from rate-limiting.
// Falls back to the original URL if anything fails.
function optimizeStreamForRateLimit(stream) {
    if (!stream || !stream.url || !stream.url.includes(".m3u8")) {
        return Promise.resolve(stream);
    }

    var originalUrl = stream.url;
    var referer = stream._referer || "https://net52.cc";

    return fetch(originalUrl, {
        method: 'GET',
        headers: {
            "User-Agent": STREAM_USER_AGENT,
            "Referer": referer,
            "Origin": "https://net52.cc",
            "Accept": "*/*"
        }
    }).then(function(response) {
        return response.text();
    }).then(function(masterM3u8) {
        // Check if this is actually a master playlist (has multiple qualities)
        var streamInfCount = (masterM3u8.match(/#EXT-X-STREAM-INF/g) || []).length;
        if (streamInfCount <= 1) {
            // Single quality or sub-playlist â€” return original URL
            return stream;
        }

        // Parse the master m3u8 and keep only 480p + all audio/subtitle tracks
        var lines = masterM3u8.split("\n");
        var modified = [];
        var keepNextStreamUrl = false;
        var found480 = false;

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();

            // Always keep header lines
            if (line.startsWith("#EXTM3U") || line.startsWith("#EXT-X-VERSION")) {
                modified.push(line);
                continue;
            }

            // Keep ALL audio and subtitle tracks (they're on a different CDN, not rate-limited)
            if (line.startsWith("#EXT-X-MEDIA:")) {
                modified.push(line);
                continue;
            }

            // For stream-inf, only keep 480p (or lowest available if no 480p)
            if (line.startsWith("#EXT-X-STREAM-INF")) {
                if (line.includes("480")) {
                    modified.push(line);
                    keepNextStreamUrl = true;
                    found480 = true;
                } else {
                    keepNextStreamUrl = false;
                }
                continue;
            }

            // Stream URL line â€” only keep if we flagged it
            if (line.startsWith("http")) {
                if (keepNextStreamUrl) {
                    modified.push(line);
                }
                keepNextStreamUrl = false;
                continue;
            }

            // Skip empty lines and unknown tags for non-kept streams
            if (line && !line.startsWith("#")) {
                // Non-URL, non-comment line â€” skip
                continue;
            }
        }

        // If no 480p found, keep the lowest bandwidth stream
        if (!found480 && modified.length > 0) {
            // Re-parse and keep the last (lowest bandwidth) stream
            modified = [];
            var lastStreamInf = null;
            var lastStreamUrl = null;
            var seenFirst = false;

            for (var j = 0; j < lines.length; j++) {
                var l = lines[j].trim();
                if (l.startsWith("#EXTM3U") || l.startsWith("#EXT-X-VERSION")) {
                    modified.push(l);
                } else if (l.startsWith("#EXT-X-MEDIA:")) {
                    modified.push(l);
                } else if (l.startsWith("#EXT-X-STREAM-INF")) {
                    lastStreamInf = l;
                    lastStreamUrl = null;
                } else if (l.startsWith("http") && lastStreamInf) {
                    lastStreamUrl = l;
                }
            }
            // Add the last (lowest bandwidth) stream
            if (lastStreamInf && lastStreamUrl) {
                modified.push(lastStreamInf);
                modified.push(lastStreamUrl);
            }
        }

        if (modified.length < 3) {
            // Not enough content â€” return original
            return stream;
        }

        var modifiedM3u8 = modified.join("\n");

        // Check if data: URIs are feasible (NuvioMobile/MPVKit supports them)
        // Encode as base64 data: URI
        var base64 = null;
        try {
            if (typeof btoa === "function") {
                base64 = btoa(modifiedM3u8);
            } else if (typeof Buffer !== "undefined") {
                base64 = Buffer.from(modifiedM3u8, "binary").toString("base64");
            }
        } catch (e) {
            // btoa can fail with non-ASCII chars â€” use unescape trick
            try {
                base64 = btoa(unescape(encodeURIComponent(modifiedM3u8)));
            } catch (e2) {
                base64 = null;
            }
        }

        if (!base64) {
            return stream;
        }

        var dataUri = "data:application/vnd.apple.mpegurl;base64," + base64;

        console.log('[NetMirror] Optimized m3u8: stripped to 480p only (' + modifiedM3u8.length + ' bytes â†’ data: URI)');

        // Return modified stream with data: URI
        var optimized = {
            name: stream.name,
            title: stream.title,
            url: dataUri,
            quality: "480p",
            headers: stream.headers
        };
        return optimized;
    }).catch(function(error) {
        console.log('[NetMirror] m3u8 optimization failed, using original:', error.message);
        return stream;
    });
}

// Fetch streams from a platform
function fetchFromPlatform(platformKey, title, mediaType, season, episode) {
    return new Promise(function(resolve) {
        resolveApiUrl().then(function(apiBase) {
            var platform = PLATFORM_MAP[platformKey];
            var searchUrl = apiBase + "/newtv/search.php?s=" + encodeURIComponent(title);

            console.log('[NetMirror] Searching ' + platformKey + ' for: ' + title);

            return fetch(searchUrl, {
                method: 'GET',
                headers: buildHeaders(platform.ott)
            }).then(function(response) {
                return response.json();
            }).then(function(searchData) {
                if (!searchData || !searchData.searchResult || searchData.searchResult.length === 0) {
                    console.log('[NetMirror] No results on ' + platformKey);
                    return resolve(null);
                }

                // Prefer exact title match
                var match = null;
                var lowerTitle = title.toLowerCase();
                for (var i = 0; i < searchData.searchResult.length; i++) {
                    var r = searchData.searchResult[i];
                    if (r && r.t && r.t.trim().toLowerCase() === lowerTitle) {
                        match = r;
                        break;
                    }
                }
                if (!match) match = searchData.searchResult[0];

                var contentId = match.id;
                var postUrl = apiBase + "/newtv/post.php?id=" + contentId;

                return fetch(postUrl, {
                    method: 'GET',
                    headers: buildHeaders(platform.ott, { Lastep: "", Usertoken: "" })
                }).then(function(response) {
                    return response.json();
                }).then(function(postData) {
                    if (!postData) {
                        return resolve(null);
                    }
                    var targetId = contentId;

                    if (mediaType === "tv") {
                        // Skip if it's actually a movie
                        if (postData.type !== "t" && (!postData.episodes || postData.episodes.filter(function(e){return e;}).length === 0)) {
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
                                console.log('[NetMirror] S' + season + 'E' + episode + ' not found on ' + platformKey);
                                return resolve(null);
                            }

                            targetId = targetEp.id;
                            var playerUrl = apiBase + "/newtv/player.php?id=" + targetId;

                            return fetch(playerUrl, {
                                method: 'GET',
                                headers: buildHeaders(platform.ott, { "Usertoken": "" })
                            }).then(function(response) {
                                return response.json();
                            }).then(function(playerData) {
                                var result = buildStreamResult(platformKey, title, playerData, season, episode);
                                return resolve(result ? [result] : null);
                            });
                        });
                    } else {
                        // Movie â€” skip if it's actually a series
                        if (postData.type === "t" || (postData.episodes && postData.episodes.filter(function(e){return e;}).length > 0)) {
                            return resolve(null);
                        }

                        targetId = postData.main_id || contentId;
                        var playerUrl = apiBase + "/newtv/player.php?id=" + targetId;

                        return fetch(playerUrl, {
                            method: 'GET',
                            headers: buildHeaders(platform.ott, { "Usertoken": "" })
                        }).then(function(response) {
                            return response.json();
                        }).then(function(playerData) {
                            var result = buildStreamResult(platformKey, title, playerData, null, null);
                            return resolve(result ? [result] : null);
                        });
                    }
                });
            });
        }).catch(function(error) {
            console.error('[NetMirror] Platform fetch error (' + platformKey + '):', error.message);
            resolve(null);
        });
    });
}

// Main function: Get streams
function getStreams(tmdbId, mediaType, season, episode) {
    return new Promise(function(resolve) {
        season = season || 1;
        episode = episode || 1;

        var tmdbType = mediaType === "tv" ? "tv" : "movie";
        var tmdbUrl = "https://api.themoviedb.org/3/" + tmdbType + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;

        console.log('[NetMirror] Fetching ' + mediaType + ' from TMDB (ID: ' + tmdbId + ')');

        fetch(tmdbUrl, {
            method: 'GET',
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
            var platformsChecked = 0;

            platforms.forEach(function(platformKey) {
                fetchFromPlatform(platformKey, title, mediaType, season, episode).then(function(streams) {
                    platformsChecked++;

                    if (streams && streams.length > 0) {
                        console.log('[NetMirror] Found ' + streams.length + ' streams on ' + platformKey);
                        foundStreams = foundStreams.concat(streams);
                    }

                    if (platformsChecked === platforms.length) {
                        console.log('[NetMirror] Total streams found: ' + foundStreams.length);

                        // FIX #8: Optimize each stream to avoid video CDN rate limiting.
                        // This fetches each master m3u8, strips to 480p only, and returns
                        // a data: URI. Runs in parallel for all streams.
                        var optimizePromises = foundStreams.map(function(s) {
                            return optimizeStreamForRateLimit(s);
                        });
                        Promise.all(optimizePromises).then(function(optimized) {
                            // Remove the _referer internal field from each stream
                            var clean = optimized.map(function(s) {
                                if (s && s._referer) {
                                    var copy = {};
                                    for (var k in s) {
                                        if (k !== "_referer") copy[k] = s[k];
                                    }
                                    return copy;
                                }
                                return s;
                            });
                            resolve(clean);
                        }).catch(function(e) {
                            resolve(foundStreams);
                        });
                    }
                }).catch(function(error) {
                    console.error('[NetMirror] Error on ' + platformKey + ':', error.message);
                    platformsChecked++;

                    if (platformsChecked === platforms.length) {
                        resolve(foundStreams);
                    }
                });
            });

        }).catch(function(error) {
            console.error('[NetMirror] TMDB fetch error:', error.message);
            resolve([]);
        });
    });
}

module.exports = { getStreams: getStreams };
