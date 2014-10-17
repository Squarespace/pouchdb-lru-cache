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
      return db.put({
        _id: MAIN_DOC_ID,
        _attachments: {},
        lastUsed: {}
      }).then(function () {
        return db.get(MAIN_DOC_ID);
      });
    } else {
      throw err;
    }
  }).then(function (doc) {
    if (!doc._attachments) {
      doc._attachments = {};
    }
    return doc;
  });
}

/*
 * Avoids errors if e.g. the key is "constructor"
 *
 */
function encodeKey(key) {
  return '$' + key;
}

function decodeKey(key) {
  return key.substring(1);
}

function calculateTotalSize(mainDoc) {
  var digestsToSizes = {};

  // dedup by digest, since that's what Pouch does under the hood
  Object.keys(mainDoc._attachments).forEach(function (attName) {
    var att = mainDoc._attachments[attName];
    digestsToSizes[att.digest] = att.length;
  });

  var total = 0;
  Object.keys(digestsToSizes).forEach(function (digest) {
    total += digestsToSizes[digest];
  });
  return total;
}

function getLeastRecentlyUsed(mainDoc) {
  var digestsToLastUsed = {};

  // dedup by digest, use the most recent date
  Object.keys(mainDoc._attachments).forEach(function (attName) {
    var att = mainDoc._attachments[attName];
    var existing  = digestsToLastUsed[att.digest] || 0;
    digestsToLastUsed[att.digest] = Math.max(existing, mainDoc.lastUsed[att.digest]);
  });

  var min;
  var minDigest;
  Object.keys(digestsToLastUsed).forEach(function (digest) {
    var lastUsed = digestsToLastUsed[digest];
    if (typeof min === 'undefined' || min > lastUsed) {
      min = lastUsed;
      minDigest = digest;
    }
  });
  return minDigest;
}

exports.initLru = function (maxSize) {
  var db = this;

  if (typeof maxSize !== 'number' || maxSize === 0) {
    maxSize = Number.MAX_VALUE; // infinity
  }

  var api = {};

  api.put = function (key, blob, type) {
    key = encodeKey(key);
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
    }).then(function () {
      return getMainDoc(db);
    }).then(function (mainDoc) {
      var digest = mainDoc._attachments[key].digest;

      mainDoc.lastUsed[digest] = new Date().getTime();

      var totalSize = calculateTotalSize(mainDoc);

      if (totalSize <= maxSize) {
        return db.put(mainDoc); // nothing to do
      }

      // else need to trim the cache, i.e. delete the LRU
      // objects until we fit in the size

      while (totalSize > maxSize) {
        var leastUsedDigest = getLeastRecentlyUsed(mainDoc);

        var attNames = Object.keys(mainDoc._attachments);
        for (var i = 0; i < attNames.length; i++) {
          var attName = attNames[i];
          if (mainDoc._attachments[attName].digest === leastUsedDigest) {
            delete mainDoc._attachments[attName];
          }
        }
        totalSize = calculateTotalSize(mainDoc);
      }
      return db.put(mainDoc);
    }).then(function () {
      return db.compact(); // attachments associated with non-leaf revisions will be deleted
    });

    queue = promise.catch(noop); // squelch
    return promise;
  };

  api.get = function (key) {
    key = encodeKey(key);

    var promise = queue.then(function () {
      return getMainDoc(db);
    }).then(function (mainDoc) {
      var att = mainDoc._attachments[key];
      if (att && mainDoc.lastUsed[att.digest]) {
        mainDoc.lastUsed[att.digest] = new Date().getTime();
        return db.put(mainDoc);
      }
    }).then(function () {
      return db.getAttachment(MAIN_DOC_ID, key);
    });

    queue = promise.catch(noop); // squelch
    return promise;
  };

  api.info = function () {
    var promise = queue.then(function () {
      return getMainDoc(db);
    }).then(function (mainDoc) {

      var items = {};
      var digestsToLength = {};

      Object.keys(mainDoc._attachments).forEach(function (key) {
        var att = mainDoc._attachments[key];
        key = decodeKey(key);
        items[key] = {
          length: att.length,
          digest: att.digest,
          lastUsed: mainDoc.lastUsed[att.digest]
        };
        digestsToLength[att.digest] = att.length;
      });

      var totalLength = 0;
      Object.keys(digestsToLength).forEach(function (digest) {
        totalLength += digestsToLength[digest];
      });

      return {
        items: items,
        numUniqueItems: Object.keys(digestsToLength).length,
        totalLength: totalLength
      };
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
