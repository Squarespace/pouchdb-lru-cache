'use strict';

var utils = require('./pouch-utils');

var MAIN_DOC_ID = 'lru__';

/*
 * Do everything in a single queue to ensure we don't get 409s.
 */
var queue = utils.Promise.resolve();

var noop = function () {};

/*
 * Store all attachments in a single doc. Since attachments
 * are deduped, and unless the attachment metadata can't all fit
 * in memory at once, there's no reason not to do this.
 */
function getMainDoc(db) {
  return db.get(MAIN_DOC_ID).catch(function (err) {
    /* istanbul ignore else */
    if (err.status === 404) {
      return {_id: MAIN_DOC_ID, _attachments: {}};
    } else {
      throw err;
    }
  });
}

/*
 * Avoids errors if e.g. the key is "constructor"
 *
 */
function createKey(key) {
  return '$' + key;
}

exports.initLru = function (maxSize) {
  var db = this;

  var api = {};

  api.maxSize = maxSize;

  api.put = function (key, blob, type) {
    key = createKey(key);
    var promise = queue.then(function () {
      if (!type) {
        throw new Error('need to specify a content-type');
      }
      return getMainDoc(db);
    }).then(function (mainDoc) {
      if (mainDoc._attachments[key]) {
        return; // already stored
      }
      return db.putAttachment(MAIN_DOC_ID, key, mainDoc._rev, blob, type);
    });

    queue = promise.catch(noop); // squelch
    return promise;
  };

  api.get = function (key) {
    key = createKey(key);

    var promise = queue.then(function () {
      return db.getAttachment(MAIN_DOC_ID, key);
    });

    queue = promise.catch(noop); // squelch
    return promise;
  };

  db.lru = api;
};

/* istanbul ignore next */
if (typeof window !== 'undefined' && window.PouchDB) {
  window.PouchDB.plugin(exports);
}
