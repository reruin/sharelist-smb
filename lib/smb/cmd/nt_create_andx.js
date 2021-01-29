/*
 *  Copyright 2015 Adobe Systems Incorporated. All rights reserved.
 *  This file is licensed to you under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License. You may obtain a copy
 *  of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software distributed under
 *  the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 *  OF ANY KIND, either express or implied. See the License for the specific language
 *  governing permissions and limitations under the License.
 */

'use strict';

var binary = require('binary');
var put = require('put');
var logger = require('winston').loggers.get('smb');
var _ = require('lodash');
var async = require('async');

var ntstatus = require('../../ntstatus');
var common = require('../../common');
var SMB = require('../constants');
var utils = require('../../utils');

// flags
var NT_CREATE_REQUEST_OPLOCK = 0x00000002;  // If set, the client requests an exclusive OpLock.
var NT_CREATE_REQUEST_OPBATCH = 0x00000004;  // If set, the client requests an exclusive batch OpLock.
var NT_CREATE_OPEN_TARGET_DIR = 0x00000008; // If set, the client indicates that the parent directory of the target is to be opened.
var NT_CREATE_REQUEST_EXTENDED_RESPONSE = 0x00000010; // If set, then the client is requesting extended information in the response.

// FileStatusFlags
var NO_EAS = 0x0001;  // The file or directory has no extended attributes.
var NO_SUBSTREAMS = 0x0002; // The file or directory has no data streams other than the main data stream.
var NO_REPARSETAG = 0x0004; // The file or directory is not a reparse point.

/**
 * SMB_COM_NT_CREATE_ANDX (0xA2):
 * This command is used to create and open a new file, or to open an existing file,
 * or to open and truncate an existing file to zero length, or to create a directory,
 * or to create a connection to a named pipe.
 *
 * @param {Object} msg - an SMB message object
 * @param {Number} commandId - the command id
 * @param {Buffer} commandParams - the command parameters
 * @param {Buffer} commandData - the command data
 * @param {Number} commandParamsOffset - the command parameters offset within the SMB
 * @param {Number} commandDataOffset - the command data offset within the SMB
 * @param {Object} connection - an SMBConnection instance
 * @param {Object} server - an SMBServer instance
 * @param {Function} cb callback called with the command's result
 * @param {Object} cb.result - an object with the command's result params and data
 *                             or null if the handler already sent the response and
 *                             no further processing is required by the caller
 * @param {Number} cb.result.status
 * @param {Buffer} cb.result.params
 * @param {Buffer} cb.result.data
 */
function handle(msg, commandId, commandParams, commandData, commandParamsOffset, commandDataOffset, connection, server, cb) {
  // decode params
  var parser = binary.parse(commandParams);
  var paramsObj = parser.skip(4) // skip andX header
    .skip(1)  // Reserved
    .word16le('nameLength')
    .word32le('flags')
    .word32le('rootDirectoryFID')
    .word32le('desiredAccess')
    .word64le('allocationSize')
    .word32le('extFileAttributes')
    .word32le('shareAccess')
    .word32le('createDisposition')
    .word32le('createOptions')
    .word32le('impersonationLevel')
    .word8('securityFlags')
    .vars;
  _.assign(msg, paramsObj);

  // decode data
  // pad to align subsequent unicode strings (utf16le) on word boundary
  var off = utils.calculatePadLength(commandDataOffset, 2);
  msg.fileName = utils.extractUnicodeBytes(commandData, off).toString('utf16le');

  logger.debug('[%s] flags: %s, rootDirectoryFID: %d, desiredAccess: %s, allocationSize: %d, extFileAttributes: %s, shareAccess: %s, createDisposition: 0x%s, createOptions: %s, impersonationLevel: 0x%s, securityFlags: %s, fileName: %s', SMB.COMMAND_TO_STRING[commandId].toUpperCase(), msg.flags.toString(2), msg.rootDirectoryFID, msg.desiredAccess.toString(2), msg.allocationSize, msg.extFileAttributes.toString(2), msg.shareAccess.toString(2), msg.createDisposition.toString(16), msg.createOptions.toString(16), msg.impersonationLevel.toString(16), msg.securityFlags.toString(2), msg.fileName);

  var result;

  var tree = server.getTree(msg.header.tid);
  if (!tree) {
    result = {
      status: ntstatus.STATUS_SMB_BAD_TID,
      params: utils.EMPTY_BUFFER,
      data: utils.EMPTY_BUFFER
    };
    process.nextTick(function () { cb(result); });
    return;
  }

  // todo evaluate/handle rootDirectoryFID
  // todo evaluate/handle flags, desiredAccess, extFileAttributes and shareAccess according to the CIFS spec

  function getFile(callback) {
    if (msg.rootDirectoryFID) {
      var parent = tree.getFile(msg.rootDirectoryFID);
      // todo evaluate/handle rootDirectoryFID, i.e. resolve filename relative to specified parent directory
    }
    tree.openOrCreate(msg.fileName, msg.createDisposition, !!(msg.createOptions & common.FILE_DIRECTORY_FILE), callback);
  }

  function buildResult(file, callback) {
    var smbCreated = utils.systemToSMBTime(file.getCreatedTime());
    var smbLastModified = utils.systemToSMBTime(file.getLastModifiedTime());
    var smbLastAccessed = utils.systemToSMBTime(file.getLastAccessedTime());
    var smbLastChanged = utils.systemToSMBTime(file.getLastChangedTime());

    // params
    var out = put();
    out.word8(commandParams.readUInt8(0)) // andX next cmd id
      .word8(0) // andX reserved
      .word16le(commandParams.readUInt16LE(2))  // andX offset (needs to be recalculated by caller!)
      .word8(msg.flags & NT_CREATE_REQUEST_OPBATCH ? 2 : 0)  // OpLockLevel
      .word16le(file.fid) // FID
      .word32le(file.getCreateAction()) // CreateDisposition
      .word32le(smbCreated.getLowBitsUnsigned()) // CreationTime
      .word32le(smbCreated.getHighBitsUnsigned())
      .word32le(smbLastAccessed.getLowBitsUnsigned()) // LastAccessTime
      .word32le(smbLastAccessed.getHighBitsUnsigned())
      .word32le(smbLastModified.getLowBitsUnsigned()) // LastWriteTime
      .word32le(smbLastModified.getHighBitsUnsigned())
      .word32le(smbLastChanged.getLowBitsUnsigned()) // LastChangeTime
      .word32le(smbLastChanged.getHighBitsUnsigned())
      //.word32le(file.getAttributes()) // ExtFileAttributes
      .word32le(file.getAttributes()) // ExtFileAttributes
      .word64le(file.getAllocationSize()) // AllocationSize
      .word64le(file.getDataSize()) // EndOfFile
      .word16le(file.getTree().getShare().isNamedPipe() ? SMB.FILE_TYPE_MESSAGEMODEPIPE : SMB.FILE_TYPE_DISK);  // ResourceType
    if (msg.flags & NT_CREATE_REQUEST_EXTENDED_RESPONSE) {
      // MS-SMB v1.0
      out.word16le(NO_EAS | NO_SUBSTREAMS | NO_REPARSETAG)  // FileStatusFlags
        .word8(file.isDirectory() ? 1 : 0)  // Directory
        .put(utils.ZERO_GUID)  // VolumeGUID
        .word64le(0)  // FileId
        .word32le(file.isDirectory() ? SMB.DIRECTORY_ACCESS_ALL : SMB.FILE_ACCESS_ALL)  // MaximalAccessRights
        .word32le(file.isDirectory() ? SMB.DIRECTORY_ACCESS_READONLY : SMB.FILE_ACCESS_READONLY);  // GuestMaximalAccessRights
    } else {
      // CIFS
      out.word16le(0)  // NMPipeStatus2
        .word8(file.isDirectory() ? 1 : 0);  // Directory
    }
    var params = out.buffer();

    result = {
      status: ntstatus.STATUS_SUCCESS,
      params: params,
      data: utils.EMPTY_BUFFER
    };
    // hack for weird windows smb server (and samba) behavior:
    // https://msdn.microsoft.com/en-us/library/cc246806.aspx#Appendix_A_51
    if (params.length / 2 > 0x2a) {
      result.wordCount = 0x2a;
    }

    callback(null, result);
  }

  async.waterfall([ getFile, buildResult ], function (err, result) {
    if (err) {
      logger.debug(msg.fileName, err.message ? err.message : err);
      cb({
        status: err.status || ntstatus.STATUS_UNSUCCESSFUL,
        params: utils.EMPTY_BUFFER,
        data: utils.EMPTY_BUFFER
      });
    } else {
      cb(result);
    }
  });
}

module.exports = handle;
