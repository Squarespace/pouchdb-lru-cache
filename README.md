PouchDB LRU Cache
=====

[![Build Status](https://travis-ci.org/Squarespace/pouchdb-lru-cache.svg)](https://travis-ci.org/Squarespace/pouchdb-lru-cache) [![Coverage Status](https://coveralls.io/repos/Squarespace/pouchdb-lru-cache/badge.svg?branch=master&service=github)](https://coveralls.io/github/Squarespace/pouchdb-lru-cache?branch=master) [![npm version](https://badge.fury.io/js/pouchdb-lru-cache.svg)](http://badge.fury.io/js/pouchdb-lru-cache)

An LRU (least recently used) cache designed for storing binary data in PouchDB. Runs in modern browsers and Node.js.

Example
----

```js
var db = new PouchDB('my_cache');
db.initLru(5000000); // store 5 MB maximum

// store a blob or a buffer
db.lru.put('file1.png', blobOrBuffer).then(function () {
  // store another blob/buffer
  return db.lru.put('file2.png', anotherBlobOrBuffer);
}).then(function () {
  // if the files add up to >5MB, file1 will be evicted before file2
  return db.lru.get('file1.png');
}).then(function (fetchedBlob) {
  // yay, we fetched file1!
  // now file2 will be evicted before file1
}).catch(function (err) {
  // file1 was evicted
});
```

Motivation
-------

In mobile and offline-ready webapps, you often want to have a small store of binary data that you can guarantee won't grow out of control. For instance, this could be used for caching images so that you don't have to re-load them every time.

This is entirely possible in PouchDB, but implementing it correctly requires some subtle knowledge of how PouchDB deduplicates attachments and how CouchDB compaction works. Hence this plugin.

Why PouchDB? Because it's the most [efficient](http://pouchdb.com/faq.html#data_types) and [well-tested](https://travis-ci.org/pouchdb/pouchdb) way to store binary data with cross-browser support. This plugin works in IE 10+, Windows Phone 8, Firefox, Firefox OS, Chrome, Safari, iOS, Android, and Node.js.

Since Blobs in the browser are kinda tricky to work with, you may also want to look into [blob-util](https://github.com/nolanlawson/blob-util).

Usage
----

To get the plugin, download it from the `dist` files above or from Bower:

```
bower install pouchdb-lru-cache
```

Then include it after `pouchdb.js` in your HTML page:

```html
<script src="pouchdb.js"></script>
<script src="pouchdb.lru-cache.js"></script>
```

Or to use it in Node.js or Browserify, just `npm install` it:

```
npm install pouchdb-lru-cache
```

And then attach it to the `PouchDB` object:

```js
var PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-lru-cache'));
```

API
-----

All API calls are on a `db` object created using `new PouchDB('myName')`. For best performance, you should use a separate DB for this LRU plugin and not call any non-LRU methods on the `db`.

The API is largely a ~~blatant ripoff~~ homage to [node-lru-cache](https://github.com/isaacs/node-lru-cache).

### Overview

* [`db.initLru([maxSize])`](#dbinitlrumaxsize)
* [`db.lru.put(key, blob, type)`](#dblruputkey-blob--type)
* [`db.lru.get(key)`](#dblrugetkey)
* [`db.lru.peek(key)`](#dblrupeekkey)
* [`db.lru.del(key)`](#dblrudelkey) 
* [`db.lru.has(key)`](#dblruhaskey)
* [`db.lru.info()`](#dblruinfo)

### db.initLru([maxSize])

Sets up the LRU plugin. You must call this before you can do any of the other API calls. It will create a magical `db.lru` object, which you will need for the other stuff.

#### Arguments:

* `maxSize`:  maximum number of bytes to store, total, in the LRU cache. Use `0` (or unspecified) for unlimited storage.

#### Example:

```js
db.initLru(5000000); // store 5 MB maximum
db.initLru(0); // no limit
```

This is a synchronous method and does not return a Promise.

**Note:** see an important [caveat](#caveats) below about the true size on disk.

### db.lru.put(key, blob, type)

Store a binary Blob in the database. Returns a Promise that will resolve with success if the attachment was successfully stored.

#### Arguments:

* `key`: a String to use to identify the blob (e.g. a URL).
* `blob`: an HTML5 [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob?redirectlocale=en-US&redirectslug=DOM%2FBlob), Node [Buffer](http://nodejs.org/api/buffer.html), or a base64-encoded string.
* `type`: the content-type, e.g. `'text/plain'`, `'image/png'`, `'image/jpeg'`, etc. Yes, this is redundant in the case of an HTML5 Blob, but we require it because Node `Buffer`s and base64-encoded strings do not have an inherent type.

#### Example:

With HTML5 Blobs:

```js
var blob = new Blob(['some text data'], {type: 'text/plain'});
db.lru.put('my_id', blob).then(function () {
  // success
}).catch(function (err) {
  // failure. might occur because you hit the storage limit, or because the size
  // of the attachment is bigger than the max_size, or because your computer
  // exploded.
});
```

With base64 strings:

```js
var base64 = btoa('some text data');
db.lru.put('my_id', base64, 'text/plain').then(function () {
  // success
}).catch(function (err) {
  // failure
});
```

### db.lru.get(key)

Get a Promise for the binary data associated with the given String `key`. The data is always returned in HTML5 Blob format (or a Buffer in Node). If the data is not present (either because it got evicted, or because it never existed), then you'll get an error with status 404.

#### Arguments:

* `key`: a String to use to identify the blob (e.g. a URL).

#### Example:

```js
db.lru.get('my_id').then(function (blob) {
  // yo, we got a blob
}).catch(function (err) {
  if (err.status === 404) {
    // nope, doesn't exist
  } else {
    // some other nasty error. maybe your computer asploded
  }
});
```

### db.lru.peek(key)

Same as `get()`, but doesn't update the recent-ness of the blob.

#### Arguments:

* `key`: the String that identifies the blob.

### db.lru.del(key)

Deletes the blob associated with the key, or does nothing if the blob doesn't exist or is already deleted.

Returns a Promise that resolves when the deletion is complete.

#### Arguments:

* `key`: the String that identifies the blob.

### db.lru.has(key)

Returns a Promise for `true` if the blob is in the store, or `false` if it was deleted, evicted, or never existed.

#### Arguments:

* `key`: the String that identifies the blob.

#### Example:

```js
db.lru.has('my_id').then(function (hasIt) {
  if (hasIt) {
    // yep, the blob exists
  } else {
    // nope, go fish
  }
});
```

### db.lru.info()

Returns a Promise for some basic information about what's stored in the LRU cache.

### Example:

```js
db.lru.info().then(function (info) {
  // got the info object
}).catch(function (err) {
  // 'splodey computer
});
```

The `info` object might look like this:

```js
{
  "items": {
    "foo.png": {
      "length": 68,
      "digest": "md5-l4wb7knXrV/BpNgQmbE+GA==",
      "lastUsed": 1413557267330
    },
    "bar.png": {
      "length": 68,
      "digest": "md5-l4wb7knXrV/BpNgQmbE+GA==",
      "lastUsed": 1413557267330
    },
    "baz.png": {
      "length": 67,
      "digest": "md5-7cVkAmmX4suBnAFSJ4A2Wg==",
      "lastUsed": 1413557267332
    }
  },
  "numUniqueItems": 2,
  "numEvicted": 0,
  "totalLength": 135
}
```

Return values:

* `items`: map of keys to the stored attachments, represented as their byte `length`, MD5 `digest`, and `lastUsed` timestamp.
* `numUniqueItems`: number of stored items after deduplication.
* `numEvicted`: number of unique items evicted from the store. If the same attachment is evicted more than once, the number will not increment.
* `totalLength`: total byte `length` of all unique items

Notice that the LRU cache takes into consideration the fact that attachments are deduped based on digest in PouchDB.

Implementation details
--------

### PouchDB 3.1.0+ only

This plugin only works with PouchDB 3.1.0+. Before that, attachments were not compacted.

### `maxSize` is an estimate

The `maxSize` specified in `initLru()` refers to the byte length of the binary attachments as interpreted by PouchDB (i.e. `blob.size`). The underlying storage engine may take up more actual space on disk than the byte length, depending on the browser and adapter. PouchDB's [FAQ page](http://pouchdb.com/faq.html#data_types) has some details.

In IndexedDB, modern browsers (Chrome 43+, Firefox, and IE 10+) will store Blobs directly to disk, so there should be a 1-to-1 correspondence between `blob.size` and the space taken up on disk. In Chrome <43 and Android <5.0, it will be signficantly more due to PouchDB's base64 workaround.

In WebSQL, you can't really predict how much space a BLOB will consume; see [this thread](http://sqlite.1065341.n5.nabble.com/Writing-in-a-blob-td68340.html) for details. In [my own tests](https://github.com/pouchdb/pouchdb/issues/2910), it seemed to vary up to 50% overhead, proably due to [WebSQL coercion of blobs to binary strings](https://github.com/litehelpers/Cordova-sqlite-storage/issues/255#issuecomment-101367587).

Furthermore, the `maxSize` does not account for the metadata that needs to be stored in order to *describe* the attachments, so you should give yourself a reasonable buffer when you choose a `maxSize`.

Browsers also have [storage limits](http://pouchdb.com/faq.html#data_limits), so be aware of them.

### CouchDB

This plugin also works on CouchDB, but YMMV. In particular, CouchDB doesn't dedup attachments based on digest (instead it uses doc ID + attachment name), so the assumptions this plugin makes about the true underlying size may be wrong.

### Auto-compaction

You can use a PouchDB with `auto_compaction` enabled, but it's not necessary, because this plugin already does the compaction for you.

### Perf tricks

If you look at the code, you'll also see that I store data in a `_local` doc. This is a special class of document that doesn't retain its full version history, so it avoids the metadata growing unreasonably large over time. Local docs are also faster than regular docs for normal gets/puts.

### Replication

This plugin is not really designed for databases you want to replicate. In particular, the use of a `_local` document makes it un-replicatable.

Building
----
    npm install
    npm run build

The plugin is now located at `dist/pouchdb.lru-cache.js` and `dist/pouchdb.lru-cache.min.js` and is ready for distribution.

Testing
----

### In Node

This will run the tests in Node using LevelDB:

    npm test
    
You can also check for 100% code coverage using:

    npm run coverage

If you have mocha installed globally you can run single test with:
```
TEST_DB=local mocha --reporter spec --grep search_phrase
```

The `TEST_DB` environment variable specifies the database that PouchDB should use (see `package.json`).

### In the browser

Run `npm run dev` and then point your favorite browser to [http://127.0.0.1:8001/test/index.html](http://127.0.0.1:8001/test/index.html).

The query param `?grep=mysearch` will search for tests matching `mysearch`.

### Automated browser tests

You can run e.g.

    CLIENT=selenium:firefox npm test
    CLIENT=selenium:phantomjs npm test

This will run the tests automatically and the process will exit with a 0 or a 1 when it's done. Firefox uses IndexedDB, and PhantomJS uses WebSQL.

License
----

Licensed under the Apache License, v2.0.

Copyright, 2015, Squarespace, Inc.
