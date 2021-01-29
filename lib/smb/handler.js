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

var fs = require('fs');
var path = require('path');

var logger = require('winston').loggers.get('smb');
var async = require('async');
var domain = require('domain');

var ntstatus = require('../ntstatus');
var message = require('./message');
var SMB = require('./constants');

var cmdHandlers = {};

function loadCmdHandlers() {
  var p = path.join(__dirname, 'cmd');
  var files = fs.readdirSync(p);
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var stat = fs.statSync(path.resolve(p, f));
    if (stat.isDirectory()) {
      continue;
    }
    if (f.substr(-3) === '.js') {
      f = f.slice(0, -3);
      cmdHandlers[f] = require(path.resolve(p, f));
    }
  }
}
loadCmdHandlers();

/**
 * Handle binary CIFS/SMB 1.0 message
 *
 * @param {Buffer} msgBuf - raw message buffer
 * @param {SMBConnection} connection - an SMBConnection instance
 * @param {SMBServer} server - an SMBServer instance
 * @param {Function} cb callback called on completion
 */
function handleRequest(msgBuf, connection, server, cb) {

  // validate length
  if (msgBuf.length < SMB.SMB_MIN_LENGTH || msgBuf.length > SMB.SMB_MAX_LENGTH) {
    cb('SMBHeader length outside range [' + SMB.SMB_MIN_LENGTH + ',' + SMB.SMB_MAX_LENGTH + ']: ' + msgBuf.length + ', data: ' + msgBuf.toString('hex'));
    return;
  }

  _handleRequest(message.decode(msgBuf), connection, server, cb);
}

/**
 * Handle binary CIFS/SMB 1.0 message
 *
 * @param {message} msg - decoded message
 * @param {SMBConnection} connection - an SMBConnection instance
 * @param {SMBServer} server - an SMBServer instance
 * @param {Function} cb callback called on completion
 */
function _handleRequest(msg, connection, server, cb) {
  // invoke async command handlers
  async.eachSeries(msg.commands,
    function (cmd, callback) {
      var command = SMB.COMMAND_TO_STRING[cmd.commandId];
      if (!command) {
        // unknown command
        callback({
          status: ntstatus.STATUS_SMB_BAD_COMMAND,
          message: 'encountered invalid command 0x' + cmd.commandId.toString(16)
        });
      }
      var handler = cmdHandlers[command];
      if (handler) {
        var d = domain.create();

        d.on('error', function (err) {
          logger.error('encountered unhandled exception at the handler level. exiting', err);
          process.exit(1);
        });
        d.run(function () {
          // process command
          handler(msg, cmd.commandId, cmd.params, cmd.data, cmd.paramsOffset, cmd.dataOffset, connection, server, function (result) {
            if (!result) {
              // special case (see e.g. 'echo' handler): no further processing required
              msg.processed = true;
              callback();
            } else if (result.status === ntstatus.STATUS_SUCCESS
              || result.status === ntstatus.STATUS_MORE_PROCESSING_REQUIRED) {
              // command succeeded: stash command result
              cmd.params = result.params;
              // override wordCount?
              if (result.wordCount) {
                cmd.wordCount = result.wordCount;
              }
              cmd.data = result.data;
              // override byteCount?
              if (result.byteCount) {
                cmd.byteCount = result.byteCount;
              }
              if (result.status === ntstatus.STATUS_MORE_PROCESSING_REQUIRED) {
                msg.header.status = result.status;
              }
              callback();
            } else {
              // command failed
              callback({
                status: result.status,
                message: '\'' + command.toUpperCase() + '\' returned error status ' + ntstatus.STATUS_TO_STRING[result.status] + ' (0x' + result.status.toString(16) + ')'
              });
            }
          });
        });
      } else {
        // no handler found
        callback({
          status: ntstatus.STATUS_NOT_IMPLEMENTED,
          message: 'encountered unsupported command 0x' + cmd.commandId.toString(16) + ' \'' + command.toUpperCase() + '\''
        });
      }
    },
    function (err) {
      if (err) {
        if (err.status === ntstatus.STATUS_NOT_IMPLEMENTED) {
          logger.error(err.message);
        } else {
          logger.debug(err.message);
        }
        sendResponse(msg, err.status, connection, server, cb);
        return;
      }
      if (msg.processed) {
        // special case (see e.g. 'echo' handler): no further processing required
        cb();
        return;
      }
      sendResponse(msg, msg.header.status || ntstatus.STATUS_SUCCESS, connection, server, cb);
    }
  );
}

function sendResponse(msg, status, connection, server, cb) {
  // make sure the 'reply' flag is set
  msg.header.flags.reply = true;
  msg.header.flags.ntStatus = true;
  // todo set other default flags?
  msg.header.flags.unicode = true;
  msg.header.flags.pathnames.long.supported = true;

  msg.header.status = status;

  connection.sendRawMessage(message.encode(msg), cb);
}

module.exports.handleRequest = handleRequest;
module.exports.sendResponse = sendResponse;
