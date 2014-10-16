/*jshint expr:true */
'use strict';

var PouchDB = require('pouchdb');

//
// your plugin goes here
//
var plugin = require('../');
PouchDB.plugin(plugin);

var chai = require('chai');
chai.use(require("chai-as-promised"));

//
// more variables you might want
//
var should = chai.should(); // var should = chai.should();
var Promise = require('bluebird'); // var Promise = require('bluebird');

var dbs;
if (process.browser) {
  dbs = 'testdb' + Math.random() +
    ',http://localhost:5984/testdb' + Math.round(Math.random() * 100000);
} else {
  dbs = process.env.TEST_DB;
}

dbs.split(',').forEach(function (db) {
  var dbType = /^http/.test(db) ? 'http' : 'local';
  tests(db, dbType);
});

function chain(promiseFactories) {
  var promise = Promise.resolve();
  promiseFactories.forEach(function (promiseFactory) {
    promise = promise.then(promiseFactory);
  });
  return promise;
}

function tests(dbName, dbType) {

  var db;

  beforeEach(function () {
    db = new PouchDB(dbName);
    return db;
  });
  afterEach(function () {
    return PouchDB.destroy(dbName);
  });
  describe(dbType + ': main test suite', function () {
    this.timeout(30000);

    function blobEquals(blob, base64) {
      if (typeof process === 'undefined' || !process.browser) {
        should.equal(blob.toString('base64'), base64);
      } else {
        return new Promise(function (resolve) {
          var reader = new FileReader();
          reader.onloadend = function () {
            var binary = "";
            var bytes = new Uint8Array(this.result || '');
            var length = bytes.byteLength;

            for (var i = 0; i < length; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            resolve(btoa(binary));
          };
          reader.readAsArrayBuffer(blob);
        });
      }

    }

    it('should store an attachment', function () {
      db.initLru();

      return db.lru.put('mykey', 'Zm9v', 'text/plain').then(function () {
        return db.lru.get('mykey');
      }).then(function (blob) {
        return blobEquals(blob, 'Zm9v');
      });
    });

    it('should store an attachment twice', function () {
      db.initLru();

      return db.lru.put('mykey', 'Zm9v', 'text/plain').then(function () {
        return db.lru.get('mykey');
      }).then(function (blob) {
        return blobEquals(blob, 'Zm9v');
      }).then(function () {
        return db.lru.put('mykey', 'Zm9v', 'text/plain');
      });
    });

    it('should throw 404s', function () {
      db.initLru();

      return db.lru.get('mykey').then(function () {
        throw new Error('should not be here');
      }, function (err) {
        err.status.should.equal(404);
      });
    });

    it('works with blobs', function () {
      db.initLru();
      return db.lru.put('mykey', 'Zm9v', 'text/plain').then(function () {
        return db.lru.get('mykey');
      }).then(function (blob) {
        return db.lru.put('otherkey', blob, 'text/plain');
      });
    });

    it('throws an err if you forget the type', function () {
      db.initLru();
      return db.lru.put('mykey', 'Zm9v', 'text/plain').then(function () {
        return db.lru.get('mykey');
      }).then(function (blob) {
        return db.lru.put('otherkey', blob).then(function () {
          throw new Error('should not be here');
        }, function (err) {
          should.exist(err);
        });
      });
    });

    it('deletes the least-recently used things', function () {
      // the contents are "foo" and "bar", so let's try going over 5
      db.initLru(5);
      return db.lru.put('foo', 'Zm9v', 'text/plain').then(function () {
        return db.lru.get('foo');
      }).then(function (blob) {
        return blobEquals(blob, 'Zm9v');
      }).then(function () {
        return db.lru.put('bar', 'YmFy', 'text/plain');
      }).then(function () {
        return db.lru.get('foo').then(function () {
          throw new Error('should not be here');
        }, function (err) {
          should.exist(err);
        });
      }).then(function () {
        return db.lru.get('bar');
      }).then(function (blob) {
        return blobEquals(blob, 'YmFy');
      });
    });

    it('doesn\'t delete if unnecessary', function () {
      // the contents are "foo" and "bar", i.e. each length 3

      var sizes = [0, 6, 10, 100000000];

      return chain(sizes.map(function (size) {
        return function () {
          db.initLru(size);
          return db.lru.put('foo', 'Zm9v', 'text/plain').then(function () {
            return db.lru.get('foo');
          }).then(function (blob) {
            return blobEquals(blob, 'Zm9v');
          }).then(function () {
            return db.lru.put('bar', 'YmFy', 'text/plain');
          }).then(function () {
            return db.lru.get('foo');
          }).then(function (blob) {
            return blobEquals(blob, 'Zm9v');
          }).then(function () {
            return db.lru.get('bar');
          }).then(function (blob) {
            return blobEquals(blob, 'YmFy');
          });
        };
      }));

    });
  });
}
