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

var logger = require('winston').loggers.get('default');
var crypto = require('crypto');
var Long = require('long');

var utils = require('./utils');

/**
 * Returns a buffer with random 8 bytes
 */
function createChallenge() {
  return crypto.randomBytes(8);
}

var LM_MAGIC = 'KGS!@#$%';

/**
 * Returns the 16-byte LM hash of the provided clear-text ascii password
 *
 * @param {String} pwd clear-text ascii password
 * @return {Buffer}
 */
function createLMHash(pwd) {
  // make sure ascii password is 14 chars max and uppercase
  var pwdBytes = new Buffer(pwd.substring(0, 14).toUpperCase(), 'ascii');
  // zero pad to 14 bytes
  var keyBuf = new Buffer(14);
  pwdBytes.copy(keyBuf);
  keyBuf.fill(0x0, pwdBytes.length);
  // the results consists of 2 8-byte DES encrypted key chunks
  var parts = [];
  var des = crypto.createCipheriv('des-ecb', expandKey(keyBuf.slice(0, 7)), '');
  parts.push(des.update(LM_MAGIC));
  des = crypto.createCipheriv('des-ecb', expandKey(keyBuf.slice(7)), '');
  parts.push(des.update(LM_MAGIC));
  return Buffer.concat(parts);
}

/**
 * Calculates the 24-byte LM response based on the LM hash and (server) challenge
 *
 * @see http://davenport.sourceforge.net/ntlm.html#theLmResponse
 *
 * @param lmHash
 * @param challenge
 * @return {Buffer}
 */
function calculateLMResponse(lmHash, challenge) {
  // grow 16-byte hash to 21-bytes and zero-pad
  var hash = new Buffer(21);
  lmHash.copy(hash);
  hash.fill(0x0, 16);

  // the response consists of 3 8-byte DES encrypted chunks
  var chunks = [];

  var des = crypto.createCipheriv('des-ecb', expandKey(hash.slice(0, 7)), '');
  chunks.push(des.update(challenge));
  des = crypto.createCipheriv('des-ecb', expandKey(hash.slice(7, 14)), '');
  chunks.push(des.update(challenge));
  des = crypto.createCipheriv('des-ecb', expandKey(hash.slice(14)), '');
  chunks.push(des.update(challenge));

  return Buffer.concat(chunks);
}

/**
 * Calculates the 24-byte LMv2 response based on the NTLMv2 hash, client challenge and (server) challenge.
 *
 * @see http://davenport.sourceforge.net/ntlm.html#theLmv2Response
 *
 * @param ntlm2Hash
 * @param clientChallenge
 * @param challenge
 * @return {Buffer} 24-byte LMv2 response consisting of 16-byte hmac and 8-byte client challenge
 */
function calculateLM2Response(ntlm2Hash, clientChallenge, challenge) {
  var data = Buffer.concat([ challenge, clientChallenge ]);
  var hmac = crypto.createHmac('md5', ntlm2Hash).update(data).digest();
  return Buffer.concat([ hmac, clientChallenge ]);
}

/**
 * Returns the 16-byte NTLM hash of the provided clear-text password
 *
 * @param {String} pwd clear-text password
 * @return {Buffer}
 */
function createNTLMHash(pwd) {
  var buf = new Buffer(pwd, 'utf16le');
  var md4 = crypto.createHash('md4');
  md4.update(buf);
  return new Buffer(md4.digest());
}

/**
 * Calculates the 24-byte NTLM response based on the NTLM hash and challenge
 *
 * @see http://davenport.sourceforge.net/ntlm.html#theNtlmResponse
 *
 * @param ntlmHash
 * @param challenge
 * @return {Buffer}
 */
function calculateNTLMResponse(ntlmHash, challenge) {
  // grow 16-byte hash to 21-bytes and zero-pad
  var hash = new Buffer(21);
  ntlmHash.copy(hash);
  hash.fill(0x0, 16);

  // the response consists of 3 8-byte DES encrypted chunks
  var chunks = [];

  var des = crypto.createCipheriv('des-ecb', expandKey(hash.slice(0, 7)), '');
  chunks.push(des.update(challenge));
  des = crypto.createCipheriv('des-ecb', expandKey(hash.slice(7, 14)), '');
  chunks.push(des.update(challenge));
  des = crypto.createCipheriv('des-ecb', expandKey(hash.slice(14)), '');
  chunks.push(des.update(challenge));

  return Buffer.concat(chunks);
}

/**
 * Returns the 16-byte NTLMv2 hash based on the NTLM hash, user and domain
 *
 * @param {Buffer} ntlmHash
 * @param {String} userName
 * @param {String} domainName
 * @return {Buffer}
 */
function createNTLM2Hash(ntlmHash, userName, domainName) {
  var data = new Buffer(userName.toUpperCase() + domainName.toUpperCase(), 'utf16le');
  return crypto.createHmac('md5', ntlmHash).update(data).digest();
}

/**
 * Calculates the NTLMv2 response based on the NTLM hash and (server) challenge
 *
 * @see http://davenport.sourceforge.net/ntlm.html#theNtlmv2Response
 *
 * @param ntlm2Hash
 * @param blob
 * @param challenge
 * @return {Buffer} NTLMv2 response consisting of 16-byte hmac and variable length blob
 */
function calculateNTLM2Response(ntlm2Hash, blob, challenge) {
  var data = Buffer.concat([ challenge, blob ]);
  var hmac = crypto.createHmac('md5', ntlm2Hash).update(data).digest();
  return Buffer.concat([ hmac, blob ]);
}

/*
 * Expand a 7-byte key (56-bit) to a 8-byte (64-bit) key
 * by inserting odd-parity bits.
 */
function expandKey(key56) {
  var PARITY_MASK = 0x01;

  var key64 = new Buffer(8);
  key64[0] = key56[0] & 0xfe;
  key64[0] &= ~PARITY_MASK;
  key64[1] = ((key56[0] << 7) & 0xff) | (key56[1] >> 1);
  key64[1] |= PARITY_MASK;
  key64[2] = ((key56[1] << 6) & 0xff) | (key56[2] >> 2);
  key64[2] &= ~PARITY_MASK;
  key64[3] = ((key56[2] << 5) & 0xff) | (key56[3] >> 3);
  key64[3] |= PARITY_MASK;
  key64[4] = ((key56[3] << 4) & 0xff) | (key56[4] >> 4);
  key64[4] &= ~PARITY_MASK;
  key64[5] = ((key56[4] << 3) & 0xff) | (key56[5] >> 5);
  key64[5] |= PARITY_MASK;
  key64[6] = ((key56[5] << 2) & 0xff) | (key56[6] >> 6);
  key64[6] &= ~PARITY_MASK;
  key64[7] = (key56[6] << 1) & 0xff;
  key64[7] |= PARITY_MASK;
  return key64;
}

function validateLMResponse(lmResponse, lmHash, challenge) {
  if (lmResponse.length !== 24) {
    logger.warn('invalid LM response: expected length: 24, actual length: %d, data: %s', lmResponse.length, lmResponse.toString('hex'));
    return false;
  }
  var resp = calculateLMResponse(lmHash, challenge);
  return utils.bufferEquals(resp, lmResponse);
}

function validateLMv2Response(lm2Response, ntlmHash, userName, domainName, challenge) {
  if (lm2Response.length !== 24) {
    logger.warn('invalid LMv2 response: expected length: 24, actual length: %d, data: %s', lm2Response.length, lm2Response.toString('hex'));
    return false;
  }
  var hash = createNTLM2Hash(ntlmHash, userName, domainName);
  var nonce = lm2Response.slice(16);
  var resp = calculateLM2Response(hash, nonce, challenge);
  return utils.bufferEquals(resp, lm2Response);
}

function validateNTLMResponse(ntlmResponse, ntlmHash, challenge) {
  if (ntlmResponse.length !== 24) {
    logger.warn('invalid NTLM response: expected length: 24, actual length: %d, data: %s', ntlmResponse.length, ntlmResponse.toString('hex'));
    return false;
  }
  var resp = calculateNTLMResponse(ntlmHash, challenge);
  return utils.bufferEquals(resp, ntlmResponse);
}

var MIN_BLOB_SIZE = 36;
var BLOB_SIGNATURE = new Buffer([ 0x01, 0x01, 0x00, 0x00 ]);

function parseNTLMv2Blob(blob) {
  if (blob.length < MIN_BLOB_SIZE) {
    logger.warn('invalid NTLMv2 blob: expected length: >=%d, actual length: %d, data: %s', MIN_BLOB_SIZE, blob.length, blob.toString('hex'));
    return null;
  }
  var obj = {};
  var off = 0;
  obj.signature = blob.slice(off, 4);
  off += 4;
  obj.reserved = blob.slice(off, off + 4);
  off += 4;
  var timeLow = blob.readUInt32LE(off);
  off += 4;
  var timeHigh = blob.readUInt32LE(off);
  off += 4;
  obj.timeStamp = new Date(utils.smbToSystemTime(new Long(timeLow, timeHigh)));
  obj.nonce = blob.slice(off, off + 8);
  off += 8;
  obj.unknown = blob.slice(off, off + 4);
  off += 4;

  // read variable length attribute/value list
  obj.info = {};
  var EOL = 0x0000;
  var type = blob.readUInt16LE(off);
  off += 2;
  while (type !== EOL) {
    var len = blob.readUInt16LE(off);
    off += 2;
    obj.info[type] = blob.slice(off, off + len);
    off += len;
    type = blob.readUInt16LE(off);
    off += 2;
  }
  // skip length (=0) following EOL
  off += 2;

  obj.unknown2 = blob.slice(off, off + 4);
  off += 4;
  if (off < blob.length) {
    obj.unknownTrailer = blob.slice(off);
  }
  return obj;
}

function validateNTLMv2Response(ntlm2Response, ntlmHash, userName, domainName, challenge) {
  if (ntlm2Response.length < 16 + MIN_BLOB_SIZE) {
    logger.warn('invalid NTLMv2 response: expected length: >=60, actual length: %d, data: %s', ntlm2Response.length, ntlm2Response.toString('hex'));
    return false;
  }
  var hash = createNTLM2Hash(ntlmHash, userName, domainName);
  var blob = ntlm2Response.slice(16);
  var blobObj = parseNTLMv2Blob(blob);
  if (!utils.bufferEquals(BLOB_SIGNATURE, blobObj.signature)) {
    logger.warn('invalid NTLMv2 blob signature: expected: %s, actual: %s', BLOB_SIGNATURE.toString('hex'), blob.slice(0, 4).toString('hex'));
    return false;
  }
  var resp = calculateNTLM2Response(hash, blob, challenge);
  return utils.bufferEquals(resp, ntlm2Response);
}

module.exports.createChallenge = createChallenge;
// helpers
module.exports.validateLMResponse = validateLMResponse;
module.exports.validateLMv2Response = validateLMv2Response;
module.exports.validateNTLMResponse = validateNTLMResponse;
module.exports.validateNTLMv2Response = validateNTLMv2Response;

module.exports.lm = {
  createHash: createLMHash,
  calculateResponse: calculateLMResponse,
  RESPONSE_LENGTH: 24
};

module.exports.lm2 = {
  createHash: createNTLM2Hash,
  calculateResponse: calculateLM2Response,
  RESPONSE_LENGTH: 24
};

module.exports.ntlm = {
  createHash: createNTLMHash,
  calculateResponse: calculateNTLMResponse,
  RESPONSE_LENGTH: 24
};

module.exports.ntlm2 = {
  createHash: createNTLM2Hash,
  calculateResponse: calculateNTLM2Response,
  parseBlob: parseNTLMv2Blob,
  MIN_RESPONSE_LENGTH: 16 + MIN_BLOB_SIZE
};
