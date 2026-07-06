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
function buildStreamResult(platformKey, title, playerData, season, episode) {
    if (!playerData || !playerData.video_link) {
        return null;
    }
    var nameLabel = platformKey.charAt(0).toUpperCase() + platformKey.slice(1);
    var streamTitle = title;
    if (season !== null && season !== undefined && episode !== null && episode !== undefined) {
        streamTitle = title + ' Â· S' + season + 'E' + episode;
    }
    return {
        name: "NetMirror (" + nameLabel + ")",
        title: streamTitle,
        url: playerData.video_link,
        quality: "Auto",
        headers: {
            "Referer": playerData.referer || "https://net52.cc",
            "User-Agent": STREAM_USER_AGENT,
            "Origin": "https://net52.cc"
        }
    };
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
                        resolve(foundStreams);
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
