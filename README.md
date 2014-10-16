PouchDB LRU Cache
=====

[![Build Status](https://travis-ci.org/squarespace/pouchdb-lru-cache.svg)](https://travis-ci.org/squarespace/pouchdb-lru-cache)

An LRU (least recently used) cache designed for storing binary data in PouchDB.

Motivation
-------

In mobile and offline-ready apps, you often want to have a small store of binary data that you can guarantee won't grow out of control. This is entirely possible in PouchDB, but implementing it correctly requires some subtle knowledge of how PouchDB deduplicates attachments and how CouchDB compaction works.

Why PouchDB? Because it's the best and [most efficient] way to store binary data cross-browser. You could just use Web SQL, but then  you'd be locked into a Webkit-only implementation. This code will work on IE 10+, Windows Phone 8, Firefox, Firefox OS, Chrome, Safari, iOS, and Android.

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

* db.initLru([maxSize])
* db.lru.put(key, blob)
* db.lru.get(key)

### db.initLru(maxSize)

Sets up the LRU plugin. You must call this before you can do any of the other API calls. It will create a magical `db.lru` object, which you will need for the other stuff.

#### Arguments:

* `maxSize`:  maximum number of bytes to store, total, in the LRU cache. Use `0` (or unspecified) for unlimited storage.

#### Example:

```js
db.initLru(5000000); // store 5 MB maximum
db.initLru(0); // no limit
```

This is a synchronous method and does not return a Promise.

**Caveat**: the size specified here refers to the byte size as interpreted by PouchDB. The underlying storage engine may take up more actual space on disk than that, [depending on the browser](http://pouchdb.com/faq.html#data_types). However, most browsers seem to have fixed their inefficiency issues, so this will become less of a problem going forward. 

### db.lru.put(key, blob [, type])

Store a binary Blob in the database. Returns a Promise that will resolve with success if the attachment was successfully stored.

### Arguments:

* `key`: a String to use to identify the blob (e.g. a URL).
* `blob`: an HTML5 [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob?redirectlocale=en-US&redirectslug=DOM%2FBlob) object or a base64-encoded string.
* `type`: content-type of the Blob. If you gave a base64-encoded string for the `blob` argument, then you must supply a type. Otherwise we can automatically infer the type from an HTML5 Blob, so it's not necessary.

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

Get the binary data from the database based on the given String `key`. The data is always returned in HTML5 Blob format. If the data is not present (e.g. because it got evicted), then you'll get an error with status 404.

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