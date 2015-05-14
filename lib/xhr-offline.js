var extend = require('xtend/mutable')
var EventEmitter = require('events').EventEmitter
var inherits = require('inherits')

var readyStates = require('./ready-states')
var xhrEvents = require('./events')
var cache = require('./cache')

var OrigXMLHttpRequest = window.XMLHttpRequest

var MAX_RETRIES = 10
var PROGRESS_TIMEOUT = 15 * 1000 // 15 seconds

function XHROffline () {
  // Request
  this._xhr = new OrigXMLHttpRequest()

  addEventHandlers.call(this)
  setDefaultState.call(this)
  EventEmitter.call(this)
}

inherits(XHROffline, EventEmitter)

var XHRProto = extend(XHROffline.prototype, readyStates)

// Map DOM Events to EventEmitter
XHRProto.addEventListener = XHRProto.addListener
XHRProto.removeEventListener = XHRProto.removeListener
XHRProto.dispatchEvent = XHRProto.emit

// Support legacy event handlers e.g. xhr.onprogress
xhrEvents.forEach(function (evt) {
  Object.defineProperty(XHRProto, 'on' + evt, {
    get: function () {
      return this.listeners(evt)[0]
    },
    set: function (value) {
      this.addListener(evt, value)
    }
  })
})

var passthroughProps = ['responseType', 'withCredentials', 'timeout']
passthroughProps.forEach(function (prop) {
  Object.defineProperty(XHRProto, prop, {
    get: function () {
      return this._xhr[prop]
    },
    set: function (value) {
      // **TODO** cache different response types separately
      this._xhr[prop] = value
      return this._xhr[prop]
    }
  })
})

XHRProto.abort = function () {
  this._xhr.abort()
  clearTimeout(this._timeout)
  setDefaultState.call(this)
}

XHRProto.open = function (method, url, async, user, password) {
  this.abort()
  // default async = true
  async = (async !== false) || false
  user = user || ''
  password = password || ''
  this._request = {
    method: method,
    url: url,
    async: async,
    user: user,
    password: password
  }
  this._xhr.open(method, url, async, user, password)
}

XHRProto.getAllResponseHeaders = function () {
  if (Object.keys(this._responseHeaders).length === 0) return null
  return this._responseHeaders
}

XHRProto.getResponseHeader = function (header) {
  if (typeof this._responseHeaders[header] === 'undefined') return null
  return this._responseHeaders[header]
}

XHRProto.setRequestHeader = function (header, value) {
  this._xhr.setRequestHeader(header, value)
  this._request.headers[header] = value
}

XHRProto.send = function (data) {
  this._data = data
  try {
    this._xhr.send(data)
    // If we get no progress events for PROGRESS_TIMEOUT,
    // then we retry the request.
    this._timeout = setTimeout(retry.bind(this), PROGRESS_TIMEOUT)
  } catch (e) {
    console.warn(e)
    retry.bind(this)
  }

  if (this._request.method !== 'GET') return

  cache.get(this._request, onCacheGet.bind(this))

  function onCacheGet (err, response) {
    if (err) return console.error(err)
    // If we don't have anything in the cache,
    // do nothing and the server XHR will continue
    if (!response) return console.log('nothing in cache')
    // If the request has been aborted, or if the xhr
    // has already returned done, then do nothing
    if (this.readyState === readyStates.UNSENT ||
      this._xhr.readyState === readyStates.DONE) return

    extend(this, response)
    console.log('got from cache', this.status)
    emitLoadEvents.call(this)
  }
}

XHRProto.overrideMimeType = function (mimeType) {
  this._xhr.overrideMimeType(mimeType)
}

/**
 * Private methods
 */

function setDefaultState () {
  // Current state
  this.readyState = readyStates.UNSENT

  this._request = {
    headers: {}
  }
  this._retries = 0
  this._data = undefined
  this._responseHeaders = {}

  // Result & response
  this.responseText = ''
  this.responseXML = ''
  this.status = null
  this.statusText = null
}

function addEventHandlers () {
  var _this = this
  var xhr = _this._xhr
  xhr.addEventListener('progress', onprogress)
  xhr.addEventListener('readystatechange', onreadystatechange)

  // These events are passed through from the xhr only if nothing
  // was found in the cache
  var passthroughEvents = ['error', 'load', 'loadstart', 'progress', 'loadend']
  passthroughEvents.forEach(function (evt) {
    xhr.addEventListener(evt, handler)
    _this.addEventListener(evt, function () {})

    function handler (e) {
      if (evt === 'error') console.error(e)
      if (_this.readyState === readyStates.DONE) return
      _this.emit(evt, e)
    }
  })

  function onload () {
    var response = {
      responseText: xhr.responseText,
      responseXml: xhr.responseXML,
      status: xhr.status,
      statusText: xhr.statusText,
      _responseHeaders: xhr.getAllResponseHeaders()
    }

    clearTimeout(_this._timeout)

    // If we haven't already returned a response from the cache,
    // inherit xhr response and emit load event
    if (_this.readyState !== readyStates.DONE) {
      extend(_this, response)
      emitLoadEvents.call(_this)
    }

    // Store response in the cache
    cache.set(_this._request, response, function (err) {
      if (err) console.error(err)
    })
  }

  function onprogress () {
    console.log('progress event')
    if (xhr.readyState === readyStates.HEADERS_RECEIVED) {
      _this._responseHeaders = xhr.getAllResponseHeaders()
    }
    clearTimeout(_this._timeout)
    _this._timeout = setTimeout(retry.bind(_this), PROGRESS_TIMEOUT)
  }

  function onreadystatechange () {
    console.log('readyState = ', xhr.readyState)
    // We handle DONE readyState with the 'load' event handler
    if (xhr.readyState === readyStates.DONE) return onload()
    if (_this.readyState !== readyStates.DONE) {
      _this.readyState = xhr.readyState
      _this.emit('readystatechange')
    }
  }
}

function retry () {
  this._retries++
  var xhr = this._xhr
  if (this._retries > MAX_RETRIES) return this.abort()
  xhr.abort()
  var req = this._request
  console.info('Retrying request to %s, %s of %s retries', req.url, this._retries, MAX_RETRIES)
  xhr.open(req.method, req.url, req.async, req.user, req.password)
  for (var header in req.headers) {
    xhr.setRequestHeader(header, req.headers[header])
  }
  xhr.send(this._data)
}

function emitLoadEvents () {
  this.readyState = readyStates.DONE
  this.emit('load')
  this.emit('readystatechange')
}

module.exports = XHROffline
