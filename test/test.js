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
    this.timeout(30000);
    db = new PouchDB(dbName);
    return db;
  });
  afterEach(function () {
    this.timeout(30000);
    return db.destroy();
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

    it('deletes multiple least-recently used things', function () {
      // the contents are "foo" and "bar", so let's try going over 8
      db.initLru(8);
      return db.lru.put('foo', 'Zm9v', 'text/plain').then(function () {
        return db.lru.put('bar', 'YmFy', 'text/plain');
      }).then(function () {
        return db.lru.put('foobar', 'Zm9vYmFy', 'text/plain');
      }).then(function () {
        return db.lru.get('foo').then(function () {
          throw new Error('should not be here: foo');
        }, function (err) {
          should.exist(err);
        });
      }).then(function () {
        return db.lru.get('bar').then(function () {
          throw new Error('should not be here: bar');
        }, function (err) {
          should.exist(err);
        });
      }).then(function () {
        return db.lru.get('foobar');
      }).then(function (blob) {
        return blobEquals(blob, 'Zm9vYmFy');
      });
    });

    it('doesnt even store one thing if too large', function () {
      // the contents are "foo" and "bar", so let's try going over 8
      db.initLru(1);
      return db.lru.put('foo', 'Zm9v', 'text/plain').then(function () {
        return db.lru.get('foo').then(function () {
          throw new Error('should not be here: foo');
        }, function (err) {
          should.exist(err);
        });
      });
    });

    it('updates what\'s recently used', function () {
      db.initLru(10);
      return db.lru.put('foo', 'Zm9v', 'text/plain').then(function () {
        return db.lru.put('bar', 'YmFy', 'text/plain');
      }).then(function () {
        return db.lru.get('foo'); // updates foo
      }).then(function () {
        return db.lru.put('foobar', 'Zm9vYmFy', 'text/plain');
      }).then(function () {
        return db.lru.get('foo');
      }).then(function () {
        return db.lru.get('foobar');
      }).then(function () {
        return db.lru.get('bar').then(function () {
          throw new Error('should not be here: foo');
        }, function (err) {
          should.exist(err);
        });
      });
    });

    it('peek() doesn\'t update what\'s recently used', function () {
      db.initLru(10);
      return db.lru.put('foo', 'Zm9v', 'text/plain').then(function () {
        return db.lru.put('bar', 'YmFy', 'text/plain');
      }).then(function () {
        return db.lru.peek('foo'); // doesn't update foo
      }).then(function (foo) {
        if (process.browser) {
          foo.type.should.match(/^text\/plain/); // buffers don't have types
        }
        return blobEquals(foo, 'Zm9v');
      }).then(function () {
        return db.lru.put('foobar', 'Zm9vYmFy', 'text/plain');
      }).then(function () {
        return db.lru.get('foo').then(function () {
          throw new Error('should not be here: foo');
        }, function (err) {
          should.exist(err);
        });
      }).then(function () {
        return db.lru.peek('foo').then(function () {
          throw new Error('should not be here: foo');
        }, function (err) {
          should.exist(err);
        });
      }).then(function () {
        return db.lru.get('foobar');
      }).then(function () {
        return db.lru.get('bar');
      }).then(function () {
        return db.lru.peek('foobar');
      }).then(function () {
        return db.lru.peek('bar');
      });
    });

    it('del() deletes stuff', function () {
      db.initLru(100);
      return db.lru.del('notexist').then(function () {
        return db.lru.put('foo', 'Zm9v', 'text/plain');
      }).then(function () {
        return db.lru.get('foo');
      }).then(function () {
        return db.lru.put('bar', 'YmFy', 'text/plain');
      }).then(function () {
        return db.lru.get('foo');
      }).then(function () {
        return db.lru.get('bar');
      }).then(function () {
        return db.lru.del('foo');
      }).then(function () {
        return db.lru.get('bar');
      }).then(function () {
        return db.lru.get('foo').then(function () {
          throw new Error('should not be here');
        }, function (err) {
          should.exist(err);
        });
      }).then(function () {
        return db.lru.del('bar');
      }).then(function () {
        return db.lru.get('bar').then(function () {
          throw new Error('should not be here');
        }, function (err) {
          should.exist(err);
        });
      }).then(function () {
        return db.lru.info();
      }).then(function (info) {
        info.numEvicted.should.equal(2);
        info.numUniqueItems.should.equal(0);
      });
    });

    it('can put after deleting', function () {
      db.initLru(5);
      return db.lru.put('foo', 'Zm9v', 'text/plain').then(function () {
        return db.lru.get('foo');
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
      }).then(function () {
        return db.lru.put('foo', 'Zm9v', '/text/plain');
      }).then(function () {
        // now the tables have turned
        return db.lru.get('foo');
      }).then(function () {
        return db.lru.get('bar').then(function () {
          throw new Error('should not be here');
        }, function (err) {
          should.exist(err);
        });
      });
    });

    // 68 in length
    var transparent1x1Png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGP6zwAAAgcBApocMXEA' +
      'AAAASUVORK5CYII=';
    // 68 in length
    var black1x1Png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNiAAAABgADNjd8qAAA' +
      'AABJRU5ErkJggg==';

    it('handles dups', function () {
      db.initLru(160);
      return db.lru.put('foo.png', transparent1x1Png, 'image/png').then(function () {
        return db.lru.put('bar.png', transparent1x1Png, 'image/png');
      }).then(function () {
        return db.lru.put('baz.png', black1x1Png, 'image/png');
      }).then(function () {
        return db.lru.get('foo.png');
      }).then(function () {
        return db.lru.get('bar.png');
      }).then(function () {
        return db.lru.get('baz.png');
      }).then(function () {
        return db.lru.info();
      }).then(function (info) {
        Object.keys(info.items).sort().should.deep.equal(
          ['bar.png', 'baz.png', 'foo.png']);
        info.numUniqueItems.should.equal(2);
        info.numEvicted.should.equal(0);
        [135, 149].indexOf(info.totalLength).should.be.above(-1,
            'expected either 135 or 149, and it is: ' + info.totalLength);
      });
    });

    it('counts evicted', function () {
      db.initLru(80);
      return db.lru.put('foo.png', transparent1x1Png, 'image/png').then(function () {
        return db.lru.put('bar.png', transparent1x1Png, 'image/png');
      }).then(function () {
        return db.lru.put('baz.png', black1x1Png, 'image/png');
      }).then(function () {
        return db.lru.get('foo.png').then(function () {
          throw new Error('should not be here');
        }, function (err) {
          should.exist(err);
        });
      }).then(function () {
        return db.lru.get('bar.png').then(function () {
          throw new Error('should not be here');
        }, function (err) {
          should.exist(err);
        });
      }).then(function () {
        return db.lru.get('baz.png');
      }).then(function () {
        return db.lru.info();
      }).then(function (info) {
        Object.keys(info.items).sort().should.deep.equal(
          ['baz.png']);
        info.numUniqueItems.should.equal(1);
        info.numEvicted.should.equal(1);
        [67, 73].indexOf(info.totalLength).should.be.above(-1,
            'expected either 67 or 73, and it is: ' + info.totalLength);
      });
    });

    function compatBtoa(str) {
      if (typeof process === 'undefined' || process.browser) {
        return btoa(str);
      } else {
        return new Buffer(str).toString('base64');
      }
    }

    it('issue #1, concurrent puts cause 409s', function () {
      this.timeout(60000);
      db.initLru(0);
      var tasks = [];
      for (var i = 0; i < 20; i++) {
        tasks.push(i);
      }
      return Promise.all(tasks.map(function (i) {
        var key = 'key_' + i;
        var value = compatBtoa(i.toString());
        return db.lru.put(key, value, 'text/plain').then(function () {
          return Promise.all([
            db.lru.put(key, value, 'text/plain'),
            db.lru.get(key),
            db.lru.put(key, value, 'text/plain'),
            db.lru.get(key),
            db.lru.put(key, value, 'text/plain'),
            db.lru.get(key),
            db.lru.put(key, value, 'text/plain')
          ]);
        });
      })).catch(function (err) {
        throw err;
      });
    });

    it('returns has() correctly', function () {
      db.initLru(5);
      return db.lru.has('dontexist').then(function (hasIt) {
        hasIt.should.equal(false);
      }).then(function () {
        return db.lru.put('foo', 'Zm9v', 'text/plain');
      }).then(function () {
        return db.lru.has('foo');
      }).then(function (hasIt) {
        hasIt.should.equal(true);
        return db.lru.put('bar', 'YmFy', 'text/plain');
      }).then(function () {
        return db.lru.has('foo');
      }).then(function (hasIt) {
        hasIt.should.equal(false);
        return db.lru.has('bar');
      }).then(function (hasIt) {
        hasIt.should.equal(true);
        return db.lru.put('foo', 'Zm9v', '/text/plain');
      }).then(function () {
        // now the tables have turned
        return db.lru.has('foo');
      }).then(function () {
        return db.lru.has('bar');
      }).then(function (hasIt) {
        hasIt.should.equal(false);
      });
    });
    
    it('repro 409 that should not happen', function () {
      db.initLru(0);

      var numSimultaneous = 20;
      var numDups = 3;

      var tasks = [];

      for (var i = 0; i < numSimultaneous; i++) {
        var key = Math.random().toString();
        var value = compatBtoa(key);
        for (var j = 0; j < numDups; j++) {
          tasks.push({key: key, value: value});
        }
      }

      function cache(src, value) {

        return db.lru.has(src).then(function (hasIt) {
          if (!hasIt) {
            return db.lru.put(src, value, 'text/plain');
          }
          return db.lru.get(src).catch(function (err) {
            if (err.status !== 404) {
              throw err;
            }
          });
        });
      }

      return Promise.all(tasks.map(function (task) {
        return cache(task.key, task.value);
      }));
    });
  });
}
