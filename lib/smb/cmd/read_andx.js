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
var Long = require('long');

var ntstatus = require('../../ntstatus');
var SMB = require('../constants');
var utils = require('../../utils');

// data offset in response SMB (from header start)
var DATA_OFFSET = 60;

/**
 * SMB_COM_READ_ANDX (0x2E): This command is used to read bytes from a regular file,
 * a named pipe, or a directly accessible device such as a serial port (COM) or printer port (LPT).
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
    .word16le('fid')
    .word32le('offset')
    .word16le('maxCountOfBytesToReturn')
    .word16le('minCountOfBytesToReturn')
    .word32le('timeoutOrMaxCountHigh')
    .word16le('remaining')
    .word32le('offsetHigh')
    .vars;
  _.assign(msg, paramsObj);

  msg.offsetHigh = (commandParams.length === 24) ? commandParams.readUInt32LE(20) : 0;
  if (msg.offsetHigh) {
    msg.offset = new Long(msg.offset, msg.offsetHigh).toNumber();
  }

  var tree = server.getTree(msg.header.tid);
  var fileName = tree && tree.getFile(msg.fid) && tree.getFile(msg.fid).getName() || null;

  logger.debug('[%s] fid: %d [fileName: %s], offset: %d, maxCountOfBytesToReturn: %d, minCountOfBytesToReturn: %d, timeoutOrMaxCountHigh: %d, remaining: %d, offsetHigh: %d', SMB.COMMAND_TO_STRING[commandId].toUpperCase(), msg.fid, fileName, msg.offset, msg.maxCountOfBytesToReturn, msg.minCountOfBytesToReturn, msg.timeoutOrMaxCountHigh, msg.remaining, msg.offsetHigh);

  var result;
  if (!tree) {
    result = {
      status: ntstatus.STATUS_SMB_BAD_TID,
      params: utils.EMPTY_BUFFER,
      data: utils.EMPTY_BUFFER
    };
    process.nextTick(function () { cb(result); });
    return;
  }

  if (tree && !tree.getShare().isNamedPipe()) {
    var maxCountHigh = commandParams.readUInt16LE(14);  // timeoutOrMaxCountHigh
    msg.maxCountOfBytesToReturn += maxCountHigh << 16;
  }
  var file = tree.getFile(msg.fid);
  if (!file) {
    result = {
      status: ntstatus.STATUS_SMB_BAD_FID,
      params: utils.EMPTY_BUFFER,
      data: utils.EMPTY_BUFFER
    };
    process.nextTick(function () { cb(result); });
    return;
  }
  if (file.isDirectory()) {
    result = {
      status: ntstatus.STATUS_FILE_IS_A_DIRECTORY,
      params: utils.EMPTY_BUFFER,
      data: utils.EMPTY_BUFFER
    };
    process.nextTick(function () { cb(result); });
    return;
  }

  var buf = new Buffer(msg.maxCountOfBytesToReturn);
  file.read(buf, 0, buf.length, msg.offset, function (err, bytesRead, buffer) {
    if (err) {
      cb({
        status: err.status || ntstatus.STATUS_UNSUCCESSFUL,
        params: utils.EMPTY_BUFFER,
        data: utils.EMPTY_BUFFER
      });
      return;
    }

    // params
    var out = put();
    out.word8(commandParams.readUInt8(0)) // andX next cmd id
      .word8(0) // andX reserved
      .word16le(commandParams.readUInt16LE(2))  // andX offset (needs to be recalculated by caller!)
      .word16le(0)  // Available
      .word16le(0)  // DataCompactionMode
      .word16le(0)  // Reserved1
      .word16le(bytesRead & 0xffff)  // DataLength
      .word16le(DATA_OFFSET)  // DataOffset
      .word16le(bytesRead >> 16)  // DataLengthHigh
      .pad(8);  // Reserved2
    var params = out.buffer();

    // data
    var data = new Buffer(1 + bytesRead);
    data.writeInt8(0, 0); // pad
    buf.copy(data, 1, 0, bytesRead);
    // return result
    result = {
      status: ntstatus.STATUS_SUCCESS,
      params: params,
      data: data
    };
    cb(result);
  });
}

module.exports = handle;