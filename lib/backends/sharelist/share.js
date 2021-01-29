/*
 *  Copyright 2020-present reruin.
 *  
 *  sharelist SMB adapter
 */

'use strict';

var util = require('util');
var fs = require('fs');

var Share = require('../../spi/share');
var FSTree = require('./tree');

class FSShare extends Share {
  constructor(name,config){

    super(name, config)
    
    this.instance = config.instance

    this.fileCount = []
  }

  isNamedPipe(){
    return false
  }

  /**
   *
   * @param {Session} session
   * @param {Buffer|String} shareLevelPassword optional share-level password (may be null)
   * @param {Function} cb callback called with the connect tree
   * @param {SMBError} cb.error error (non-null if an error occurred)
   * @param {FSTree} cb.tree connected tree
   */
  connect(session, shareLevelPassword, cb){

    let { path } = this

    cb(null , new FSTree(this))

    // var self = this;
    // function stat(done) {
    //   fs.stat(self.path, function (err, stats) {
    //     done(null, stats);
    //   });
    // }

    // function createOrValidate(stats, done) {
    //   if (!stats) {
    //     mkdirp(self.path, done);
    //   } else {
    //     if (!stats.isDirectory()) {
    //       done('invalid share configuration: ' + self.path + ' is not a valid directory path');
    //     } else {
    //       done();
    //     }
    //   }
    // }

    // async.waterfall([ stat, createOrValidate ], function (err) {
    //   if (err) {
    //     logger.error(err);
    //     var msg = typeof err === 'string' ? err : err.message;
    //     cb(SMBError.fromSystemError(err, 'unable to connect fs tree due to unexpected error'));
    //   } else {
    //     cb(null, new FSTree(self));
    //   }
    // });
  }
}

module.exports = FSShare;

