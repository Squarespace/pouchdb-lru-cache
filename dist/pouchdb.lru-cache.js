;(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

var utils = require('./pouch-utils');
var Promise = utils.Promise;

var MAIN_DOC_ID = 'lru__';
var LAST_USED_DOC_ID = '_local/lru_last_used';

// allows us to execute things synchronously
var queue = Promise.resolve();

/* istanbul ignore next */
var noop = function () {};

/**
 * Create the doc if it doesn't exist
 */
function getDocWithDefault(db, id, defaultDoc) {
  return db.get(id)["catch"](function (err) {
    /* istanbul ignore if */
    if (err.status !== 404) {
      throw err;
    }
    defaultDoc._id = id;
    return db.put(defaultDoc).then(function () {
      return db.get(id);
    });
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
 * To mitigate 409s, we synchronize certain things that need to be
 * done in a "transaction". So whatever promise is given to this
 * function will execute sequentially.
 */
function synchronous(promiseFactory) {
  return function () {
    var promise = queue.then(promiseFactory);
    queue = promise["catch"](noop); // squelch
    return promise;
  };
}

/**
 * Get a map of unique digests to when they were last used.
 */
function getDigestsToLastUsed(mainDoc, lastUsedDoc) {
  var result = {};

  // dedup by digest, use the most recent date
  Object.keys(mainDoc._attachments).forEach(function (attName) {
    var att = mainDoc._attachments[attName];
    var existing  = result[att.digest] || 0;
    result[att.digest] = Math.max(existing, lastUsedDoc.lastUsed[att.digest]);
  });

  return result;
}

/**
 * Get the digest that's the least recently used. If a digest was used
 * by more than one attachment, then favor the more recent usage date.
 */
function getLeastRecentlyUsed(mainDoc, lastUsedDoc) {
  var digestsToLastUsed = getDigestsToLastUsed(mainDoc, lastUsedDoc);

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

function putBinary(db, key, blob, type) {
  return getMainDoc(db).then(function (mainDoc) {
    if (mainDoc._attachments[key]) {
      return; // already stored
    }
    return db.putAttachment(MAIN_DOC_ID, key, mainDoc._rev, blob, type);
  });
}

function updateLastUsed(db, key, time, maxSize) {
  return getDocs(db).then(function (docs) {
    var mainDoc = docs[0];
    var lastUsedDoc = docs[1];

    var digest = mainDoc._attachments[key].digest;
    lastUsedDoc.lastUsed[digest] = time;

    var totalSize = calculateTotalSize(mainDoc);
    if (totalSize <= maxSize) {
      // don't need to update the mainDoc, just the local doc
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
  });
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

  api.put = function (rawKey, blob, type) {
    var key = encodeKey(rawKey);
    var time = Date.now();

    return Promise.resolve().then(function () {
      if (!type) {
        throw new Error('need to specify a content-type');
      }
    }).then(synchronous(function () {
      return putBinary(db, key, blob, type);
    })).then(synchronous(function () {
      return updateLastUsed(db, key, time, maxSize);
    })).then(function () {
      return db.compact(); // attachments associated with non-leaf revisions will be deleted
    });
  };

  /**
   * peek
   */
  api.peek = function (rawKey) {
    var key = encodeKey(rawKey);

    return db.getAttachment(MAIN_DOC_ID, key);
  };

  /**
   * del
   */
  api.del = function (rawKey) {
    var key = encodeKey(rawKey);

    return Promise.resolve().then(synchronous(function () {
      return getMainDoc(db).then(function (mainDoc) {
        delete mainDoc._attachments[key];
        return db.put(mainDoc);
      });
    }));
  };

  /**
   * get
   */

  api.get = function (rawKey) {
    var key = encodeKey(rawKey);
    var time = Date.now();

    return Promise.resolve().then(synchronous(function () {
      return getDocs(db).then(function (docs) {
        var mainDoc = docs[0];
        var lastUsedDoc = docs[1];

        var att = mainDoc._attachments[key];
        if (att && lastUsedDoc.lastUsed[att.digest]) {
          lastUsedDoc.lastUsed[att.digest] = time;
          return db.put(lastUsedDoc);
        }
      });
    })).then(function () {
      return db.getAttachment(MAIN_DOC_ID, key);
    });
  };

  /**
   * has
   */

  api.has = function (rawKey) {
    var key = encodeKey(rawKey);

    return getMainDoc(db).then(function (mainDoc) {
      return !!mainDoc._attachments[key];
    });
  };

  /**
   * info
   */

  api.info = function () {
    return Promise.resolve().then(function () {
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

      var numEvicted = 0;
      Object.keys(lastUsedDoc.lastUsed).forEach(function (digest) {
        if (!(digest in digestsToLength)) {
          numEvicted++;
        }
      });

      return {
        items: items,
        numUniqueItems: Object.keys(digestsToLength).length,
        numEvicted: numEvicted,
        totalLength: totalLength
      };
    });
  };

  db.lru = api;
};

/* istanbul ignore next */
if (typeof window !== 'undefined' && window.PouchDB) {
  window.PouchDB.plugin(exports);
}

},{"./pouch-utils":23}],2:[function(require,module,exports){

},{}],3:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};

process.nextTick = (function () {
    var canSetImmediate = typeof window !== 'undefined'
    && window.setImmediate;
    var canPost = typeof window !== 'undefined'
    && window.postMessage && window.addEventListener
    ;

    if (canSetImmediate) {
        return function (f) { return window.setImmediate(f) };
    }

    if (canPost) {
        var queue = [];
        window.addEventListener('message', function (ev) {
            var source = ev.source;
            if ((source === window || source === null) && ev.data === 'process-tick') {
                ev.stopPropagation();
                if (queue.length > 0) {
                    var fn = queue.shift();
                    fn();
                }
            }
        }, true);

        return function nextTick(fn) {
            queue.push(fn);
            window.postMessage('process-tick', '*');
        };
    }

    return function nextTick(fn) {
        setTimeout(fn, 0);
    };
})();

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];

process.binding = function (name) {
    throw new Error('process.binding is not supported');
}

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};

},{}],4:[function(require,module,exports){
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

},{}],5:[function(require,module,exports){
'use strict';

module.exports = INTERNAL;

function INTERNAL() {}
},{}],6:[function(require,module,exports){
'use strict';
var Promise = require('./promise');
var reject = require('./reject');
var resolve = require('./resolve');
var INTERNAL = require('./INTERNAL');
var handlers = require('./handlers');
module.exports = all;
function all(iterable) {
  if (Object.prototype.toString.call(iterable) !== '[object Array]') {
    return reject(new TypeError('must be an array'));
  }

  var len = iterable.length;
  var called = false;
  if (!len) {
    return resolve([]);
  }

  var values = new Array(len);
  var resolved = 0;
  var i = -1;
  var promise = new Promise(INTERNAL);
  
  while (++i < len) {
    allResolver(iterable[i], i);
  }
  return promise;
  function allResolver(value, i) {
    resolve(value).then(resolveFromAll, function (error) {
      if (!called) {
        called = true;
        handlers.reject(promise, error);
      }
    });
    function resolveFromAll(outValue) {
      values[i] = outValue;
      if (++resolved === len & !called) {
        called = true;
        handlers.resolve(promise, values);
      }
    }
  }
}
},{"./INTERNAL":5,"./handlers":7,"./promise":9,"./reject":12,"./resolve":13}],7:[function(require,module,exports){
'use strict';
var tryCatch = require('./tryCatch');
var resolveThenable = require('./resolveThenable');
var states = require('./states');

exports.resolve = function (self, value) {
  var result = tryCatch(getThen, value);
  if (result.status === 'error') {
    return exports.reject(self, result.value);
  }
  var thenable = result.value;

  if (thenable) {
    resolveThenable.safely(self, thenable);
  } else {
    self.state = states.FULFILLED;
    self.outcome = value;
    var i = -1;
    var len = self.queue.length;
    while (++i < len) {
      self.queue[i].callFulfilled(value);
    }
  }
  return self;
};
exports.reject = function (self, error) {
  self.state = states.REJECTED;
  self.outcome = error;
  var i = -1;
  var len = self.queue.length;
  while (++i < len) {
    self.queue[i].callRejected(error);
  }
  return self;
};

function getThen(obj) {
  // Make sure we only access the accessor once as required by the spec
  var then = obj && obj.then;
  if (obj && typeof obj === 'object' && typeof then === 'function') {
    return function appyThen() {
      then.apply(obj, arguments);
    };
  }
}
},{"./resolveThenable":14,"./states":15,"./tryCatch":16}],8:[function(require,module,exports){
module.exports = exports = require('./promise');

exports.resolve = require('./resolve');
exports.reject = require('./reject');
exports.all = require('./all');
exports.race = require('./race');
},{"./all":6,"./promise":9,"./race":11,"./reject":12,"./resolve":13}],9:[function(require,module,exports){
'use strict';

var unwrap = require('./unwrap');
var INTERNAL = require('./INTERNAL');
var resolveThenable = require('./resolveThenable');
var states = require('./states');
var QueueItem = require('./queueItem');

module.exports = Promise;
function Promise(resolver) {
  if (!(this instanceof Promise)) {
    return new Promise(resolver);
  }
  if (typeof resolver !== 'function') {
    throw new TypeError('reslover must be a function');
  }
  this.state = states.PENDING;
  this.queue = [];
  this.outcome = void 0;
  if (resolver !== INTERNAL) {
    resolveThenable.safely(this, resolver);
  }
}

Promise.prototype['catch'] = function (onRejected) {
  return this.then(null, onRejected);
};
Promise.prototype.then = function (onFulfilled, onRejected) {
  if (typeof onFulfilled !== 'function' && this.state === states.FULFILLED ||
    typeof onRejected !== 'function' && this.state === states.REJECTED) {
    return this;
  }
  var promise = new Promise(INTERNAL);

  
  if (this.state !== states.PENDING) {
    var resolver = this.state === states.FULFILLED ? onFulfilled: onRejected;
    unwrap(promise, resolver, this.outcome);
  } else {
    this.queue.push(new QueueItem(promise, onFulfilled, onRejected));
  }

  return promise;
};

},{"./INTERNAL":5,"./queueItem":10,"./resolveThenable":14,"./states":15,"./unwrap":17}],10:[function(require,module,exports){
'use strict';
var handlers = require('./handlers');
var unwrap = require('./unwrap');

module.exports = QueueItem;
function QueueItem(promise, onFulfilled, onRejected) {
  this.promise = promise;
  if (typeof onFulfilled === 'function') {
    this.onFulfilled = onFulfilled;
    this.callFulfilled = this.otherCallFulfilled;
  }
  if (typeof onRejected === 'function') {
    this.onRejected = onRejected;
    this.callRejected = this.otherCallRejected;
  }
}
QueueItem.prototype.callFulfilled = function (value) {
  handlers.resolve(this.promise, value);
};
QueueItem.prototype.otherCallFulfilled = function (value) {
  unwrap(this.promise, this.onFulfilled, value);
};
QueueItem.prototype.callRejected = function (value) {
  handlers.reject(this.promise, value);
};
QueueItem.prototype.otherCallRejected = function (value) {
  unwrap(this.promise, this.onRejected, value);
};
},{"./handlers":7,"./unwrap":17}],11:[function(require,module,exports){
'use strict';
var Promise = require('./promise');
var reject = require('./reject');
var resolve = require('./resolve');
var INTERNAL = require('./INTERNAL');
var handlers = require('./handlers');
module.exports = race;
function race(iterable) {
  if (Object.prototype.toString.call(iterable) !== '[object Array]') {
    return reject(new TypeError('must be an array'));
  }

  var len = iterable.length;
  var called = false;
  if (!len) {
    return resolve([]);
  }

  var resolved = 0;
  var i = -1;
  var promise = new Promise(INTERNAL);
  
  while (++i < len) {
    resolver(iterable[i]);
  }
  return promise;
  function resolver(value) {
    resolve(value).then(function (response) {
      if (!called) {
        called = true;
        handlers.resolve(promise, response);
      }
    }, function (error) {
      if (!called) {
        called = true;
        handlers.reject(promise, error);
      }
    });
  }
}
},{"./INTERNAL":5,"./handlers":7,"./promise":9,"./reject":12,"./resolve":13}],12:[function(require,module,exports){
'use strict';

var Promise = require('./promise');
var INTERNAL = require('./INTERNAL');
var handlers = require('./handlers');
module.exports = reject;

function reject(reason) {
	var promise = new Promise(INTERNAL);
	return handlers.reject(promise, reason);
}
},{"./INTERNAL":5,"./handlers":7,"./promise":9}],13:[function(require,module,exports){
'use strict';

var Promise = require('./promise');
var INTERNAL = require('./INTERNAL');
var handlers = require('./handlers');
module.exports = resolve;

var FALSE = handlers.resolve(new Promise(INTERNAL), false);
var NULL = handlers.resolve(new Promise(INTERNAL), null);
var UNDEFINED = handlers.resolve(new Promise(INTERNAL), void 0);
var ZERO = handlers.resolve(new Promise(INTERNAL), 0);
var EMPTYSTRING = handlers.resolve(new Promise(INTERNAL), '');

function resolve(value) {
  if (value) {
    if (value instanceof Promise) {
      return value;
    }
    return handlers.resolve(new Promise(INTERNAL), value);
  }
  var valueType = typeof value;
  switch (valueType) {
    case 'boolean':
      return FALSE;
    case 'undefined':
      return UNDEFINED;
    case 'object':
      return NULL;
    case 'number':
      return ZERO;
    case 'string':
      return EMPTYSTRING;
  }
}
},{"./INTERNAL":5,"./handlers":7,"./promise":9}],14:[function(require,module,exports){
'use strict';
var handlers = require('./handlers');
var tryCatch = require('./tryCatch');
function safelyResolveThenable(self, thenable) {
  // Either fulfill, reject or reject with error
  var called = false;
  function onError(value) {
    if (called) {
      return;
    }
    called = true;
    handlers.reject(self, value);
  }

  function onSuccess(value) {
    if (called) {
      return;
    }
    called = true;
    handlers.resolve(self, value);
  }

  function tryToUnwrap() {
    thenable(onSuccess, onError);
  }
  
  var result = tryCatch(tryToUnwrap);
  if (result.status === 'error') {
    onError(result.value);
  }
}
exports.safely = safelyResolveThenable;
},{"./handlers":7,"./tryCatch":16}],15:[function(require,module,exports){
// Lazy man's symbols for states

exports.REJECTED = ['REJECTED'];
exports.FULFILLED = ['FULFILLED'];
exports.PENDING = ['PENDING'];
},{}],16:[function(require,module,exports){
'use strict';

module.exports = tryCatch;

function tryCatch(func, value) {
  var out = {};
  try {
    out.value = func(value);
    out.status = 'success';
  } catch (e) {
    out.status = 'error';
    out.value = e;
  }
  return out;
}
},{}],17:[function(require,module,exports){
'use strict';

var immediate = require('immediate');
var handlers = require('./handlers');
module.exports = unwrap;

function unwrap(promise, func, value) {
  immediate(function () {
    var returnValue;
    try {
      returnValue = func(value);
    } catch (e) {
      return handlers.reject(promise, e);
    }
    if (returnValue === promise) {
      handlers.reject(promise, new TypeError('Cannot resolve promise with itself'));
    } else {
      handlers.resolve(promise, returnValue);
    }
  });
}
},{"./handlers":7,"immediate":18}],18:[function(require,module,exports){
'use strict';
var types = [
  require('./nextTick'),
  require('./mutation.js'),
  require('./messageChannel'),
  require('./stateChange'),
  require('./timeout')
];
var draining;
var queue = [];
//named nextTick for less confusing stack traces
function nextTick() {
  draining = true;
  var i, oldQueue;
  var len = queue.length;
  while (len) {
    oldQueue = queue;
    queue = [];
    i = -1;
    while (++i < len) {
      oldQueue[i]();
    }
    len = queue.length;
  }
  draining = false;
}
var scheduleDrain;
var i = -1;
var len = types.length;
while (++ i < len) {
  if (types[i] && types[i].test && types[i].test()) {
    scheduleDrain = types[i].install(nextTick);
    break;
  }
}
module.exports = immediate;
function immediate(task) {
  if (queue.push(task) === 1 && !draining) {
    scheduleDrain();
  }
}
},{"./messageChannel":19,"./mutation.js":20,"./nextTick":2,"./stateChange":21,"./timeout":22}],19:[function(require,module,exports){
var global=typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {};'use strict';

exports.test = function () {
  if (global.setImmediate) {
    // we can only get here in IE10
    // which doesn't handel postMessage well
    return false;
  }
  return typeof global.MessageChannel !== 'undefined';
};

exports.install = function (func) {
  var channel = new global.MessageChannel();
  channel.port1.onmessage = func;
  return function () {
    channel.port2.postMessage(0);
  };
};
},{}],20:[function(require,module,exports){
var global=typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {};'use strict';
//based off rsvp https://github.com/tildeio/rsvp.js
//license https://github.com/tildeio/rsvp.js/blob/master/LICENSE
//https://github.com/tildeio/rsvp.js/blob/master/lib/rsvp/asap.js

var Mutation = global.MutationObserver || global.WebKitMutationObserver;

exports.test = function () {
  return Mutation;
};

exports.install = function (handle) {
  var called = 0;
  var observer = new Mutation(handle);
  var element = global.document.createTextNode('');
  observer.observe(element, {
    characterData: true
  });
  return function () {
    element.data = (called = ++called % 2);
  };
};
},{}],21:[function(require,module,exports){
var global=typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {};'use strict';

exports.test = function () {
  return 'document' in global && 'onreadystatechange' in global.document.createElement('script');
};

exports.install = function (handle) {
  return function () {

    // Create a <script> element; its readystatechange event will be fired asynchronously once it is inserted
    // into the document. Do so, thus queuing up the task. Remember to clean up once it's been called.
    var scriptEl = global.document.createElement('script');
    scriptEl.onreadystatechange = function () {
      handle();

      scriptEl.onreadystatechange = null;
      scriptEl.parentNode.removeChild(scriptEl);
      scriptEl = null;
    };
    global.document.documentElement.appendChild(scriptEl);

    return handle;
  };
};
},{}],22:[function(require,module,exports){
'use strict';
exports.test = function () {
  return true;
};

exports.install = function (t) {
  return function () {
    setTimeout(t, 0);
  };
};
},{}],23:[function(require,module,exports){
var process=require("__browserify_process"),global=typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {};'use strict';

var Promise;
/* istanbul ignore next */
if (typeof window !== 'undefined' && window.PouchDB) {
  Promise = window.PouchDB.utils.Promise;
} else {
  Promise = typeof global.Promise === 'function' ? global.Promise : require('lie');
}
/* istanbul ignore next */
exports.once = function (fun) {
  var called = false;
  return exports.getArguments(function (args) {
    if (called) {
      console.trace();
      throw new Error('once called  more than once');
    } else {
      called = true;
      fun.apply(this, args);
    }
  });
};
/* istanbul ignore next */
exports.getArguments = function (fun) {
  return function () {
    var len = arguments.length;
    var args = new Array(len);
    var i = -1;
    while (++i < len) {
      args[i] = arguments[i];
    }
    return fun.call(this, args);
  };
};
/* istanbul ignore next */
exports.toPromise = function (func) {
  //create the function we will be returning
  return exports.getArguments(function (args) {
    var self = this;
    var tempCB = (typeof args[args.length - 1] === 'function') ? args.pop() : false;
    // if the last argument is a function, assume its a callback
    var usedCB;
    if (tempCB) {
      // if it was a callback, create a new callback which calls it,
      // but do so async so we don't trap any errors
      usedCB = function (err, resp) {
        process.nextTick(function () {
          tempCB(err, resp);
        });
      };
    }
    var promise = new Promise(function (fulfill, reject) {
      try {
        var callback = exports.once(function (err, mesg) {
          if (err) {
            reject(err);
          } else {
            fulfill(mesg);
          }
        });
        // create a callback for this invocation
        // apply the function in the orig context
        args.push(callback);
        func.apply(self, args);
      } catch (e) {
        reject(e);
      }
    });
    // if there is a callback, call it back
    if (usedCB) {
      promise.then(function (result) {
        usedCB(null, result);
      }, usedCB);
    }
    promise.cancel = function () {
      return this;
    };
    return promise;
  });
};

exports.inherits = require('inherits');
exports.Promise = Promise;

},{"__browserify_process":3,"inherits":4,"lie":8}]},{},[1])
;