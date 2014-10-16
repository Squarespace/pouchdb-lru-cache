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
  });
}
