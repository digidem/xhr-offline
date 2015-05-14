!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.XMLHttpRequest=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
module.exports = require('./lib/xhr-offline')

},{"./lib/xhr-offline":6}],2:[function(require,module,exports){
var util = require('./util')

var VERSION = 1
var STORE_NAME = 'responses'
var queue = []
var db

var request = window.indexedDB.open('xhrOfflineCache', VERSION)

request.addEventHandler('error', function (event) {
  console.warn('No permission to create cache')
})

request.addEventHandler('success', function (event) {
  db = event.target.result
  drainQueue()
})

request.addEventHandler('upgradeneeded', function (event) {
  db = event.target.result
  db.createObjectStore(STORE_NAME)
})

function drainQueue () {
  queue.forEach(function (item) {
    item.task(item.request, item.value || item.callback, item.callback)
  })
}

function get (request, callback) {
  if (!db) {
    queue.push({
      task: get,
      request: request,
      callback: callback
    })
    return
  }
  var key = util.objectHash(request)
  var dbRequest = db.transaction(STORE_NAME)
    .objectStore(STORE_NAME)
    .get(key)

  dbRequest.addEventHandler('success', onsuccess)
  dbRequest.addEventHandler('error', onerror)

  function onsuccess (event) {
    callback(null, event.target.result)
  }

  function onerror (event) {
    callback(new Error('Database error: ' + event.target.errorCode))
  }
}

function set (request, response, callback) {
  if (!db) {
    queue.push({
      task: set,
      request: request,
      response: response,
      callback: callback
    })
    return
  }

  get(request, function (result) {
    var method = result ? 'put' : 'add'
    var key = util.objectHash(request)

    var dbRequest = db.transaction(STORE_NAME, 'readwrite')
      .objectStore(STORE_NAME)[method](response, key)

    dbRequest.addEventHandler('success', onsuccess)
    dbRequest.addEventHandler('error', onerror)
  })

  function onsuccess (event) {
    callback(null)
  }

  function onerror (event) {
    callback(new Error('Database error: ' + event.target.errorCode))
  }
}

module.exports = {
  get: get,
  set: set
}

},{"./util":5}],3:[function(require,module,exports){
module.exports = [
  'abort',
  'error',
  'load',
  'loadstart',
  'progress',
  'timeout',
  'loadend'
]

},{}],4:[function(require,module,exports){
module.exports = {
  UNSENT: 0,
  OPENED: 1,
  HEADERS_RECEIVED: 2,
  LOADING: 3,
  DONE: 4
}

},{}],5:[function(require,module,exports){
//var crypto = require('crypto')

function objectHash (obj) {
  return md5(JSON.stringify(obj))
}

function md5 (str) {
  // var hash = crypto.createHash('md5')
  // hash.update(str, 'utf8')
  // return hash.digest('base64')
}

module.exports = {
  objectHash: objectHash,
  md5: md5
}

},{}],6:[function(require,module,exports){
var extend = require('xtend/mutable')
var EventEmitter = require('events').EventEmitter
var inherits = require('inherits')

var readyStates = require('./ready-states')
var xhrEvents = require('./events')
var cache = require('./cache')

var OrigXMLHttpRequest = window.XMLHttpRequest

var MAX_RETRIES = 10
var PROGRESS_TIMEOUT = 5 * 1000 // 5 seconds

function XHROffline () {
  // Request
  this._xhr = new OrigXMLHttpRequest()

  addEventHandlers.call(this, this._xhr)
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
      // **TODO** cache different response types
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
  return this._responseHeaders
}

XHRProto.getResponseHeader = function (header) {
  return this._responseHeaders[header]
}

XHRProto.setRequestHeader = function (header, value) {
  this._xhr.setRequestHeader(header, value)
  this._request.headers[header] = value
}

XHRProto.send = function (data) {
  this._data = data
  this._xhr.send(data)
  this._lastContact = Date.now()

  if (this._request.method !== 'GET') return

  cache.get(this._request, onCacheGet.bind(this))

  function onCacheGet (err, response) {
    if (err) return console.error(err)
    // If we don't have anything in the cache,
    // do nothing and the server XHR will continue
    if (!response) return
    // If the request has been aborted, or if the xhr
    // has already returned done, then do nothing
    if (this.readyState === readyStates.UNSENT ||
      this._xhr.readyState === readyStates.DONE) return

    extend(this, response)
    emitLoadEvents.call(this)
  }
}

XHRProto.overrideMimeType = function (mimeType) {
  return this._xhr.overrideMimeType(mimeType)
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

function addEventHandlers (xhr) {
  xhr.addEventListener('load', onload.bind(this))
  xhr.addEventListener('progress', onprogress.bind(this))
  xhr.addEventListener('readystatechange', onreadystatechange.bind(this))

  // If we get no progress events for PROGRESS_TIMEOUT,
  // then we retry the request.
  this._timeout = setTimeout(retry, PROGRESS_TIMEOUT)

  // These events are passed through from the xhr only if nothing
  // was found in the cache
  var passthroughEvents = ['error', 'loadstart', 'progress', 'loadend']
  passthroughEvents.forEach(function (evt) {
    xhr.addEventListener(evt, handler.bind(this))

    function handler (e) {
      if (this.readyState === readyStates.DONE) return
      this.emit(evt, e)
    }
  }, this)

  function onload () {
    var response = {
      responseText: xhr.responseText,
      responseXml: xhr.responseXML,
      status: xhr.status,
      statusText: xhr.statusText,
      _responseHeaders: xhr.getAllResponseHeaders()
    }

    clearTimeout(this._timeout)

    // If we haven't already returned a response from the cache,
    // inherit xhr response and emit load event
    if (this.readyState !== readyStates.DONE) {
      extend(this, response)
      emitLoadEvents.call(this)
    }

    // Store response in the cache
    cache.put(this._request, response, function (err) {
      if (err) console.error(err)
    })
  }

  function retry () {
    this.abort()
    if (this._retries > MAX_RETRIES) return
    var req = this._request
    xhr.open(req.method, req.url, req.async, req.user, req.password)
    for (var header in req.headers) {
      xhr.setRequestHeader(header, req.headers[header])
    }
    this._retries++
    xhr.send(this._data)
  }

  function onprogress () {
    if (xhr.readyState === readyStates.HEADERS_RECEIVED) {
      this._responseHeaders = xhr.getAllResponseHeaders()
    }
    clearTimeout(this._timeout)
    this._timeout = setTimeout(retry, PROGRESS_TIMEOUT)
  }

  function onreadystatechange () {
    // We handle DONE readyState with the 'load' event handler
    if (xhr.readyState === readyStates.DONE) return
    if (this.readyState !== readyStates.DONE) {
      this.readyState = xhr.readyState
      this.emit('readystatechange')
    }
  }
}

function emitLoadEvents () {
  this.readyState = readyStates.DONE
  this.emit('load')
  this.emit('readystatechange')
}

module.exports = XHROffline

},{"./cache":2,"./events":3,"./ready-states":4,"events":9,"inherits":7,"xtend/mutable":8}],7:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],8:[function(require,module,exports){
module.exports = extend

function extend(target) {
    for (var i = 1; i < arguments.length; i++) {
        var source = arguments[i]

        for (var key in source) {
            if (source.hasOwnProperty(key)) {
                target[key] = source[key]
            }
        }
    }

    return target
}

},{}],9:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      } else {
        throw TypeError('Uncaught, unspecified "error" event.');
      }
      return false;
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        len = arguments.length;
        args = new Array(len - 1);
        for (i = 1; i < len; i++)
          args[i - 1] = arguments[i];
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    len = arguments.length;
    args = new Array(len - 1);
    for (i = 1; i < len; i++)
      args[i - 1] = arguments[i];

    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    var m;
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      if (typeof console.trace === 'function') {
        // not supported in IE 10
        console.trace();
      }
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.listenerCount = function(emitter, type) {
  var ret;
  if (!emitter._events || !emitter._events[type])
    ret = 0;
  else if (isFunction(emitter._events[type]))
    ret = 1;
  else
    ret = emitter._events[type].length;
  return ret;
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}]},{},[1])(1)
});