/*
 *  Copyright 2020-present reruin.
 *  
 *  sharelist SMB adapter
 */

 
'use strict';

var util = require('util');
var fs = require('fs');
var Path = require('path');

var logger = require('winston').loggers.get('spi');
var perflog = require('winston').loggers.get('perf');
var async = require('async');

var File = require('../../spi/file');
var SMBError = require('../../smberror');
const { readFile , closeFile } = require('./utils')

class FSFile extends File {
  constructor(filePath, stats, tree){
    super(filePath, tree)
    this.stats = stats
    this.realPath = filePath
    this.writeable = false

    this.tree = tree
    if(!tree.share.fileCount[this.realPath]){
      tree.share.fileCount[this.realPath] = 0
    }
    tree.share.fileCount[this.realPath]++
    
  }

  //刷新状态
  refreshStats(filePath, tree, cb){
    cb();
  }

  //设置只读
  setReadOnly(readOnly, cb){
    //process.nextTick(function () { cb(new SMBError(ntstatus.STATUS_SMB_NO_SUPPORT)); });
  }


  isFile(){
    return this.stats.type != 'folder'
  }

  isDirectory(){
    return this.stats.type == 'folder'
  }

  isReadOnly(){
   return !this.writeable
  }

  size(){
    return this.stats.size
  }

  //分配大小
  allocationSize(){
    return this.stats.size
  }

  /**
   * Return the time of last modification, in milliseconds since
   * Jan 1, 1970, 00:00:00.0.
   *
   * @return {Number} time of last modification
   */
  lastModified(){
    return this.stats.updated_at ? new Date(this.stats.updated_at).getTime() : 0
  }

  setLastModified(){  }

  /**
   * Return the time when file status was last changed, in milliseconds since
   * Jan 1, 1970, 00:00:00.0.
   *
   * @return {Number} when file status was last changed
   */
  lastChanged () {
    return this.stats.updated_at ? new Date(this.stats.updated_at).getTime() : 0
  }

  /**
   * Return the create time, [in milliseconds] since Jan 1, 1970, 00:00:00.0.
   * Jan 1, 1970, 00:00:00.0.
   *
   * @return {Number} time created
   */
  created () {
    return this.stats.created_at ? new Date(this.stats.created_at).getTime() : 0
  }

  /**
   * Return the time of last access, [in milliseconds] since Jan 1, 1970, 00:00:00.0.
   * Jan 1, 1970, 00:00:00.0.
   *
   * @return {Number} time of last access
   */
  lastAccessed () {
    return 0
  }

  /**
   * Read bytes at a certain position inside the file.
   *
   * @param {Buffer} buffer the buffer that the data will be written to
   * @param {Number} offset the offset in the buffer to start writing at
   * @param {Number} length the number of bytes to read
   * @param {Number} position offset where to begin reading from in the file
   * @param {Function} cb callback called with the bytes actually read
   * @param {SMBError} cb.error error (non-null if an error occurred)
   * @param {Number} cb.bytesRead number of bytes actually read
   * @param {Buffer} cb.buffer buffer holding the bytes actually read
   */
  read (buffer, offset, length, position, cb) {
    readFile(this, buffer, offset, length, position,cb)
  }

  write (data, position, cb) {
    process.nextTick(function () { cb(new SMBError(ntstatus.STATUS_SMB_NO_SUPPORT)); });
  }

  /**
   * Sets the file length.
   *
   * @param {Number} length file length
   * @param {Function} cb callback called on completion
   * @param {SMBError} cb.error error (non-null if an error occurred)
   */
  setLength (length, cb) {
    process.nextTick(function () { cb(new SMBError(ntstatus.STATUS_SMB_NO_SUPPORT)); });
  }

  /**
   * Delete this file or directory. If this file denotes a directory, it must
   * be empty in order to be deleted.
   *
   * @param {Function} cb callback called on completion
   * @param {SMBError} cb.error error (non-null if an error occurred)
   */
  delete (cb) {
    process.nextTick(function () { cb(new SMBError(ntstatus.STATUS_SMB_NO_SUPPORT)); });
  }

  /**
   * Flush the contents of the file to disk.
   *
   * @param {Function} cb callback called on completion
   * @param {SMBError} cb.error error (non-null if an error occurred)
   */
  flush (cb) {
    // there's nothing to do here
    process.nextTick(function () { cb(); });
  }

  /**
   * Close this file, releasing any resources.
   *
   * @param {Function} cb callback called on completion
   * @param {SMBError} cb.error error (non-null if an error occurred)
   */
  close (cb) {
    // there's nothing to do here
    closeFile(this , cb)
    this.tree.share.fileCount[this.realPath]--
  }
}


module.exports = FSFile;


