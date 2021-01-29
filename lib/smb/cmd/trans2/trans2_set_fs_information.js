/*
 *  Copyright 2016 Adobe Systems Incorporated. All rights reserved.
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

var Path = require('path');

var put = require('put');
var logger = require('winston').loggers.get('smb');
var Long = require('long');

var ntstatus = require('../../../ntstatus');
var SMB = require('../../constants');
var utils = require('../../../utils');

/**
 * TRANS2_SET_FS_INFORMATION (0x0004): This transaction is sent by the client
 * to set file system attribute information on the server.
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
  var fid = commandParams.readUInt16LE(0);
  var informationLevel = commandParams.readUInt16LE(2);

  var tree = server.getTree(msg.header.tid);
  var fileName = tree && tree.getFile(fid) && tree.getFile(fid).getName() || null;

  logger.debug('[%s] informationLevel: %s, fid: %d [fileName: %s]', SMB.TRANS2_SUBCOMMAND_TO_STRING[commandId].toUpperCase(), SMB.SET_INFORMATION_LEVEL_TO_STRING[informationLevel], fid, fileName);

  var result;

  // NT passthrough levels: SMB.INFO_PASSTHROUGH + native level
  if (informationLevel < SMB.INFO_PASSTHROUGH) {
    result = {
      status: ntstatus.STATUS_NOT_SUPPORTED,
      params: utils.EMPTY_BUFFER,
      data: utils.EMPTY_BUFFER
    };
    process.nextTick(function () { cb(result); });
    return;
  }

  if (!tree) {
    result = {
      status: ntstatus.STATUS_SMB_BAD_TID,
      params: utils.EMPTY_BUFFER,
      data: utils.EMPTY_BUFFER
    };
    process.nextTick(function () { cb(result); });
    return;
  }

  var off;
  var file = tree.getFile(fid);
  if (!file) {
    result = {
      status: ntstatus.STATUS_SMB_BAD_FID,
      params: utils.EMPTY_BUFFER,
      data: utils.EMPTY_BUFFER
    };
    process.nextTick(function () { cb(result); });
    return;
  }

  switch (informationLevel) {
    case SMB.FILE_DISPOSITION_INFORMATION:
      var deletePending = !!commandData.readUInt8(0);
      if (deletePending) {
        logger.debug('%s, fid: %d [fileName: %s], deletePending: %d', SMB.SET_INFORMATION_LEVEL_TO_STRING[informationLevel], fid, fileName, deletePending);
        file.setDeleteOnClose();
      }
      result = {
        status: ntstatus.STATUS_SUCCESS,
        params: ntstatus.STATUS_SUCCESS,
        data: utils.EMPTY_BUFFER
      };
      process.nextTick(function () { cb(result); });
      return;

    case SMB.FILE_END_OF_FILE_INFORMATION:
      var endOfFile = Long.fromBits(commandData.readUInt32LE(0), commandData.readUInt32LE(4), true).toNumber();
      file.setLength(endOfFile, function (err) {
        if (err) {
          logger.error(err);
          result = {
            status: err.status || ntstatus.STATUS_UNSUCCESSFUL,
            params: utils.EMPTY_BUFFER,
            data: utils.EMPTY_BUFFER
          };
        } else {
          result = {
            status: ntstatus.STATUS_SUCCESS,
            params: ntstatus.STATUS_SUCCESS,
            data: utils.EMPTY_BUFFER
          };
        }
        cb(result);
      });
      return;

    case SMB.FILE_ALLOCATION_INFORMATION:
      var allocationSize = Long.fromBits(commandData.readUInt32LE(0), commandData.readUInt32LE(4), true).toNumber();
      if (!allocationSize && file.size()) {
        file.setLength(0, function (err) {
          if (err) {
            logger.error(err);
            result = {
              status: err.status || ntstatus.STATUS_UNSUCCESSFUL,
              params: utils.EMPTY_BUFFER,
              data: utils.EMPTY_BUFFER
            };
          } else {
            result = {
              status: ntstatus.STATUS_SUCCESS,
              params: ntstatus.STATUS_SUCCESS,
              data: utils.EMPTY_BUFFER
            };
          }
          cb(result);
        });
      } else {
        // todo support setting allocationSize > 0
        // for now silently ignore
        result = {
          status: ntstatus.STATUS_SUCCESS,
          params: ntstatus.STATUS_SUCCESS,
          data: utils.EMPTY_BUFFER
        };
        process.nextTick(function () { cb(result); });
      }
      return;

    case SMB.FILE_RENAME_INFORMATION:
      off = 0;
      var replaceIfExists = commandData.readUInt8(off);
      off += 1;
      off += 3; // Reserved (padding)
      var rootDirectory = commandData.readUInt32LE(off);
      off += 4;
      var fileNameLength = commandData.readUInt32LE(off);
      off += 4;
      off += utils.calculatePadLength(commandDataOffset + off, 2);   // pad to align subsequent unicode strings (utf16le) on word boundary
      //var bytes = commandData.slice(off, fileNameLength);
      //var targetName = bytes.toString('utf16le');
      var targetName = utils.extractUnicodeBytes(commandData, off).toString('utf16le');
      var targetPath = Path.join(utils.getParentPath(file.getPath()), targetName);
      logger.debug('%s, fid: %d [fileName: %s], replaceIfExists: %d, rootDirectoryHandle: %d, fileNameLength: %d, targetName: %s', SMB.SET_INFORMATION_LEVEL_TO_STRING[informationLevel], fid, fileName, replaceIfExists, rootDirectory, fileNameLength, targetName);
      tree.rename(file, targetPath, function (err) {
        cb({
          status: err ? err.status || ntstatus.STATUS_UNSUCCESSFUL : ntstatus.STATUS_SUCCESS,
          params: utils.EMPTY_BUFFER,
          data: utils.EMPTY_BUFFER
        });
      });
      return;

    default:
      logger.error('[%s] encountered unsupported or unknown informationLevel %s, fid: %d [fileName: %s]', SMB.TRANS2_SUBCOMMAND_TO_STRING[commandId].toUpperCase(), SMB.SET_INFORMATION_LEVEL_TO_STRING[informationLevel] || '0x' + informationLevel.toString(16), fid, fileName);
      // todo implement missing information lavels
      result = {
        //status: ntstatus.STATUS_OS2_INVALID_LEVEL,
        status: ntstatus.STATUS_NOT_IMPLEMENTED,
        params: utils.EMPTY_BUFFER,
        data: utils.EMPTY_BUFFER
      };
      process.nextTick(function () { cb(result); });
      return;
  }
}

module.exports = handle;
