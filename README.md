PouchDB LRU Cache
=====

[![Build Status](https://travis-ci.org/squarespace/pouchdb-lru-cache.svg)](https://travis-ci.org/squarespace/pouchdb-lru-cache)

An LRU (least recently used) cache designed for storing binary data in PouchDB.

Motivation
-------

In mobile and offline-ready webapps, you often want to have a small store of binary data that you can guarantee won't grow out of control. For instance, this could be used for caching images so that you don't have to re-load them every time.

This is entirely possible in PouchDB, but implementing it correctly requires some subtle knowledge of how PouchDB deduplicates attachments and how CouchDB compaction works. Hence this plugin.

Why PouchDB? Because it's the most [efficient](http://pouchdb.com/faq.html#data_types) and [well-tested](travis-ci.org/pouchdb/pouchdb) way to store binary data with cross-browser support. Yes, you could just use Web SQL, but then you'd be locked into a WebKit-only implementation. This code will work on IE 10+, Windows Phone 8, Firefox, Firefox OS, Chrome, Safari, iOS, Android, and Node.js.

Usage
----

To get the plugin, download it from the `dist` files above or download from Bower:

```
bower install pouchdb-lru-cache
```

Then include it after `pouchdb.js` in your HTML page:

```html
<script src="pouchdb.js"></script>
<script src="pouchdb.lru-cache.js"></script>
```

Or to use it in Node.js, just npm install it:

```
npm install pouchdb-lru-cache
```

And then attach it to the `PouchDB` object:

```js
var PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-myplugin'));
```

API
-----

All API calls are on a `db` object created using `new PouchDB('myName')`. For best performance, you should use a separate DB for this LRU plugin and not call any non-LRU methods on the `db`.

### Overview

* [`db.initLru([maxSize])`](#dbinitlrumaxsize)
* [`db.lru.put(key, blob, type)`](#dblruputkey-blob--type)
* [`db.lru.get(key)`](#dblrugetkey)
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

### Arguments:

* `key`: a String to use to identify the blob (e.g. a URL).
* `blob`: an HTML5 [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob?redirectlocale=en-US&redirectslug=DOM%2FBlob), Node [Buffer](http://nodejs.org/api/buffer.html), or a base64-encoded string.
* `type`: the content-type, e.g. `'text/plain'`, `'image/png'`, `'image/jpeg'`, etc. Yes, this is redundant in the case of an HTML5 Blob, but we require it because Node `Buffer`s and base64-encoded strings do not have an inherent type.

### Example:

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

Get the binary data from the database based on the given String `key`. The data is always returned in HTML5 Blob format (or a Buffer in Node). If the data is not present (either because it got evicted, or because it never existed), then you'll get an error with status 404.

### Arguments:

* `key`: a String to use to identify the blob (e.g. a URL).

### Example:

```js
db.lru.get('my_id').then(function (blob) {
  // yo, we got a blob
}).catch(function (err) {
  if (err.status === 404) {
    // nope, doesn't exist
  } else {
    // some other nasty error. maybe your computer asploded
  }
})
```

### db.lru.info()

Get some basic information about what's stored in the LRU cache.

### Example:

```js
db.lru.info().then(function (info) {
  // got the info object
}).catch(function (err) {
  // splodey computer
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
  "totalLength": 135
}
```

Notice that the LRU cache takes into consideration the fact that attachments are deduped based on digest in PouchDB.

Caveats
--------

The size specified in `initLru()` refers to the byte length as interpreted by PouchDB. The underlying storage engine may take up more actual space on disk than that, [depending on the browser and adapter](http://pouchdb.com/faq.html#data_types). However, most browsers seem to have fixed their inefficiency issues (Chrome 38+, Safari 7.1+, iOS 8+), so this will become less of a problem going forward.

This plugin also works on CouchDB, but YMMV. In particular, CouchDB doesn't dedup attachments based on digest, so the assumptions this plugin makes about the true underlying size may be wrong.

You can use a PouchDB with `auto_compaction` enabled, but it's not necessary, because this plugin already does the compaction for you.


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