'use strict';

var utils = require('./pouch-utils');
var Promise = utils.Promise;

var MAIN_DOC_ID = 'lru__';
var LAST_USED_DOC_ID = '_local/lru_last_used';

var noop = function () {};

/**
 * Do everything in a single queue to ensure we don't get 409s.
 */
var queue = Promise.resolve();

/**
 * Create the doc if it doesn't exist
 */
function getDocWithDefault(db, id, defaultDoc) {
  return db.get(id).catch(function (err) {
    /* istanbul ignore else */
    if (err.status === 404) {
      defaultDoc._id = id;
      return db.put(defaultDoc).then(function () {
        return db.get(id);
      });
    } else {
      throw err;
    }
  });
}

/**
 * Store all attachments in a single doc. Since attachments
 * are deduped, and unless the attachment metadata can't all fit
 * in memory at once, there's no reason not to do this.
 */
function getMainDoc(db) {
  return getDocWithDefault(db, MAIN_DOC_ID, {}).then(function (doc) {
    if (!doc._attachments) {
      doc._attachments = {};
    }
    return doc;
  });
}

/**
 * Since this data changes frequently, store the "last used" values
 * in a _local doc, so that the revision history doesn't grow excessively.
 * (_local docs don't retain any revision history in PouchDB)
 */
function getLastUsedDoc(db) {
  return getDocWithDefault(db, LAST_USED_DOC_ID, {lastUsed: {}});
}

function getDocs(db) {
  return Promise.all([getMainDoc(db), getLastUsedDoc(db)]);
}

/**
 * Avoids errors if e.g. the key is "constructor"
 *
 */
function encodeKey(key) {
  return '$' + key;
}

/**
 * Reverse of the above
 */
function decodeKey(key) {
  return key.substring(1);
}

/**
 * Get the total size of the LRU cache, taking duplicate digests into account
 */
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

/**
 * Get the digest that's the least recently used. If a digest was used
 * by more than one attachment, then favor the more recent usage date.
 */
function getLeastRecentlyUsed(mainDoc, lastUsedDoc) {
  var digestsToLastUsed = {};

  // dedup by digest, use the most recent date
  Object.keys(mainDoc._attachments).forEach(function (attName) {
    var att = mainDoc._attachments[attName];
    var existing  = digestsToLastUsed[att.digest] || 0;
    digestsToLastUsed[att.digest] = Math.max(existing, lastUsedDoc.lastUsed[att.digest]);
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

/**
 * initLru
 */

exports.initLru = function (maxSize) {
  var db = this;

  if (typeof maxSize !== 'number' || maxSize === 0) {
    maxSize = Number.MAX_VALUE; // infinity
  }

  var api = {};

  /**
   * put
   */

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
      return getDocs(db);
    }).then(function (docs) {
      var mainDoc = docs[0];
      var lastUsedDoc = docs[1];
      var digest = mainDoc._attachments[key].digest;

      lastUsedDoc.lastUsed[digest] = new Date().getTime();

      var totalSize = calculateTotalSize(mainDoc);

      if (totalSize <= maxSize) {
        // don't need to update the mainDoc, just the lastUsedDoc
        return db.put(lastUsedDoc);
      }

      while (totalSize > maxSize) {
        // need to trim the cache, i.e. delete the LRU
        // objects until we fit in the size
        var leastUsedDigest = getLeastRecentlyUsed(mainDoc, lastUsedDoc);

        var attNames = Object.keys(mainDoc._attachments);
        for (var i = 0; i < attNames.length; i++) {
          var attName = attNames[i];
          if (mainDoc._attachments[attName].digest === leastUsedDigest) {
            delete mainDoc._attachments[attName];
          }
        }
        totalSize = calculateTotalSize(mainDoc);
      }
      return db.bulkDocs([lastUsedDoc, mainDoc]);
    }).then(function () {
      return db.compact(); // attachments associated with non-leaf revisions will be deleted
    });

    queue = promise.catch(noop); // squelch
    return promise;
  };

  /**
   * get
   */

  api.get = function (key) {
    key = encodeKey(key);

    var promise = queue.then(function () {
      return getDocs(db);
    }).then(function (docs) {
      var mainDoc = docs[0];
      var lastUsedDoc = docs[1];

      var att = mainDoc._attachments[key];
      if (att && lastUsedDoc.lastUsed[att.digest]) {
        lastUsedDoc.lastUsed[att.digest] = new Date().getTime();
        return db.put(lastUsedDoc);
      }
    }).then(function () {
      return db.getAttachment(MAIN_DOC_ID, key);
    });

    queue = promise.catch(noop); // squelch
    return promise;
  };

  /**
   * info
   */

  api.info = function () {
    var promise = queue.then(function () {
      return getDocs(db);
    }).then(function (docs) {
      var mainDoc = docs[0];
      var lastUsedDoc = docs[1];

      var items = {};
      var digestsToLength = {};

      Object.keys(mainDoc._attachments).forEach(function (key) {
        var att = mainDoc._attachments[key];
        key = decodeKey(key);
        items[key] = {
          length: att.length,
          digest: att.digest,
          lastUsed: lastUsedDoc.lastUsed[att.digest]
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
