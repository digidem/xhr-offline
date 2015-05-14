/* *TODO* crypto adds a lot of kb to the library,
 * unnecessary for just the md5 function
*/
var crypto = require('crypto')

function objectHash (obj) {
  return md5(JSON.stringify(obj))
}

function md5 (str) {
  var hash = crypto.createHash('md5')
  hash.update(str, 'utf8')
  return hash.digest('base64')
}

module.exports = {
  objectHash: objectHash,
  md5: md5
}
