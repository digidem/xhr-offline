XHR-Offline
===========

This is designed to be a drop-in replacement for [XMLHttpRequest](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest) adding offline first caching and retries over slow connections.

## Rationale

Many existing offline solutions (e.g. [offline.js](http://github.hubspot.com/offline/docs/welcome/) check the network first before switching the app to offline. On a poor connection with very high latency this can lead to long delays and user frustration before the app realizes it is offline. Connections in remote areas can be extremely unreliable with high packet loss, which means that requests can take several retries before returning data.

This module will first look for a cached response and return that to the user, whether or not she/he is offline.

If nothing is cached it will act like XMLHttpRequest, but will repeatedly retry the request (see below).

If there was a cached response it will in the background make a request and cache the new response.

It will retry the request up to 10 times. A retry occurs not just after a failed request, but also after a lack of any progress events for 15 seconds (NB this is different to a request time out. The request could take longer than 15 seconds, as long as there is no period of >= 15 seconds when no data is received).

It is built as a drop-in replacement for [XMLHttpRequest](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest) and aims to replicate the version 2 API, so that external libraries can be "made offline" with little to know work.

## Design

XHR-Offline currently uses IndexedDB for cache storage so is only supported by browsers [that support IndexedDB](http://caniuse.com/#feat=indexeddb). For a cache key it uses a hash of a JSON.stringified hash of the XHR options (method, url, async, user, password) *plus* a hash of any headers set.

TODO: Add more information of architecture here.

## Shortcomings

On first load this will return potentially stale data from the cache, whilst updated data is being downloaded in the background. Using external libraries there is no way to update the UI when the cache is updated, so this currently has to be done manually.

Data is stored transparently and currently without encryption in the cache, so that sensitive / private data may be accessible if another user has access to the browser. The cache keys are md5 hashes which may contain the user and password and auth keys for a request. A stronger hash mechanism might make this more secure. We could also encrypt the cache values (the responses) if access to offline caches was considered a security risk.
