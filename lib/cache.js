var util = require('./util')

var VERSION = 3
var STORE_NAME = 'responses'
var queue = []
var db

var request = window.indexedDB.open('xhrOfflineCache', VERSION)

request.addEventListener('error', function (event) {
  console.warn('No permission to create cache')
})

request.addEventListener('success', function (event) {
  db = event.target.result
  drainQueue()
})

request.addEventListener('upgradeneeded', function (event) {
  db = event.target.result
  var objectStore = db.createObjectStore(STORE_NAME)
  objectStore.transaction.oncomplete = function () {
    console.log('object store created')
  }
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

  dbRequest.addEventListener('success', onsuccess)
  dbRequest.addEventListener('error', onerror)

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

  get(request, function (err, result) {
    if (err) return onerror(err)
    var method = result ? 'put' : 'add'
    var key = util.objectHash(request)

    var dbRequest = db.transaction(STORE_NAME, 'readwrite')
      .objectStore(STORE_NAME)[method](response, key)

    dbRequest.addEventListener('success', onsuccess)
    dbRequest.addEventListener('error', onerror)
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
