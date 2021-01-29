/*
 *  Copyright 2020-present reruin.
 *  
 *  sharelist SMB adapter
 */

'use strict';

var util = require('util');
var Path = require('path');
var fs = require('fs');

var logger = require('winston').loggers.get('spi');
var perflog = require('winston').loggers.get('perf');
var async = require('async');

var Tree = require('../../spi/tree');
var FSFile = require('./file');
var SMBError = require('../../smberror');
var utils = require('../../utils');
var mkdirp = require('mkdirp');

class FSTree extends Tree {
  constructor(share){
    super(share.config)
    this.share = share
  }


  /**
   * 打开一个已知文件.
   *
   * @param {String} name file name
   * @param {Function} cb callback called with the opened file
   * @param {SMBError} cb.error error (non-null if an error occurred)
   * @param {File} cb.file opened file
   */
  open(name, cb) {
    let basePath = (name.match(/\/[^\/]+/) || [''])[0]
    this.config.instance.setRuntime({ origin:'smb://sharelist' , path: basePath})
    // console.log(this.share.fileCount)
    
    Promise.resolve(this.config.instance.command('ls',name)).then( resp => {
      // console.log(name,'OPEN')
      
      if(resp.type != 'folder' && !resp.body){
        let k = new FSFile(name,resp,this)
        cb(null,k)
      }else{
        cb(SMBError.fromSystemError('SHARELIST', 'it is NOT a file '));
      }
    }).catch((err) => {
      console.log(err)
      cb(SMBError.fromSystemError('SHARELIST', err+'open file error '));
    })

  }

  /**
   * 根据给定规则 列出条目.
   *
   * @param {String} pattern pattern
   * @param {Function} cb callback called with an array of matching files
   * @param {SMBError} cb.error error (non-null if an error occurred)
   * @param {File[]} cb.files array of matching files
   */
  list(pattern, cb) {
    // 两种可能的模式:
    // 1. 列出目录下内容 /some/directory/*
    // 2. 仅当前目录 sample: /some/directory
    let items = []
    let basePath = (pattern.match(/\/[^\/]+/) || [''])[0]
    this.config.instance.setRuntime({ origin:'smb://sharelist' , path: basePath})

    if(pattern.endsWith('/*')){
      let parentPath = pattern.replace(/\/\*$/,'')
      let instance = this.config.instance
      Promise.resolve(instance.command('ls',parentPath)).then( resp => {
        let k = resp.children.map(i => new FSFile(i.name,i,this))
        cb(null,k)
      })
    }else{
      cb(null, []);
    }
    // cb(SMBError.fromSystemError(err, 'cannot list pattern due to unexpected error ' + pattern))
  }

  /**
   * 创建文件
   *
   * @param {String} name file name
   * @param {Function} cb callback called on completion
   * @param {SMBError} cb.error error (non-null if an error occurred)
   * @param {File} cb.file created file
   */
  createFile (name, cb) {
    process.nextTick(function () { cb(new SMBError(ntstatus.STATUS_SMB_NO_SUPPORT)); });
  }

  /**
   * 创建目录.
   *
   * @param {String} name directory name
   * @param {Function} cb callback called on completion
   * @param {SMBError} cb.error error (non-null if an error occurred)
   * @param {File} cb.file created directory
   */
  createDirectory (name, cb) {
    process.nextTick(function () { cb(new SMBError(ntstatus.STATUS_SMB_NO_SUPPORT)); });
  }

  /**
   * 删除文件
   *
   * @param {String} name file name
   * @param {Function} cb callback called on completion
   * @param {SMBError} cb.error error (non-null if an error occurred)
   */
  delete (name, cb) {
    process.nextTick(function () { cb(new SMBError(ntstatus.STATUS_SMB_NO_SUPPORT)); });
  }

  /**
   * 删除目录
   *
   * @param {String} name directory name
   * @param {Function} cb callback called on completion
   * @param {SMBError} cb.error error (non-null if an error occurred)
   */
  deleteDirectory (name, cb) {
    process.nextTick(function () { cb(new SMBError(ntstatus.STATUS_SMB_NO_SUPPORT)); });
  }

  /**
   * 重命名
   *
   * @param {String} oldName old name
   * @param {String} newName new name
   * @param {Function} cb callback called on completion
   * @param {SMBError} cb.error error (non-null if an error occurred)
   */
  rename (oldName, newName, cb) {
    process.nextTick(function () { cb(new SMBError(ntstatus.STATUS_SMB_NO_SUPPORT)); });
  }

  /**
   * 关闭链接.
   *
   * @param {Function} cb callback called on completion
   * @param {SMBError} cb.error error (non-null if an error occurred)
   */
  disconnect (cb) {
    logger.debug('[%s] tree.disconnect', this.share.config.backend);
    // there's nothing to do here
    process.nextTick(function () { cb(); });
  }

}


module.exports = FSTree