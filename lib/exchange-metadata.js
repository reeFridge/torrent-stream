const bncode = require('bncode');
const crypto = require('crypto');
const neon_bencode = require('../neon-bencode');

const METADATA_BLOCK_SIZE = 1 << 14;
const METADATA_MAX_SIZE = 1 << 22;
const EXTENSIONS = {
	m: {
		ut_metadata: 1
	}
};

/**
 * @enum {number}
 */
const MSG_TYPE = {
	REQUEST: 0,
	DATA: 1,
	REJECT: 2
};

/**
 * @param {Buffer} data
 * @return {*}
 */
function sha1(data) {
	return crypto.createHash('sha1').update(data).digest('hex');
}

/**
 * @param {Object} wire
 * @return {Promise}
 */
function handleHandshake(wire) {
	return new Promise((resolve, reject) => {
		wire.once('extended', (id, data) => {
			let handshake = {};

			try {
				handshake = neon_bencode.decode(data);
			} catch (err) {
				return reject(err);
			}

			if (id || !handshake['m'] || handshake['m']['ut_metadata'] === undefined) {
				return reject();
			}

			return resolve(handshake);
		});
	});
}

/**
 * @param {Object} wire
 * @param {function(number, Buffer)} cb
 */
function handleExtended(wire, cb) {
	wire.on('extended', cb);
}

/**
 * @param {Buffer} data
 * @return {Promise}
 */
function parseExtendedMessage(data) {
	let delimiter = null;
	let message = null;

	try {
		delimiter = data.toString('ascii').indexOf('ee');
		let dataSlice = null;

		if (delimiter === -1) {
			dataSlice = data.slice(0, delimiter + 2);
		} else {
			dataSlice = data.slice(0, data.length);
		}

		message = neon_bencode.decode(dataSlice);
	} catch (err) {
		return Promise.reject(err);
	}

	return Promise.resolve(message);
}


function handleData(metadata, size, metadataPieces, pieceIndex, pieceBuffer) {
	if (metadata) {
		return false;
	}

	metadataPieces[pieceIndex] = pieceBuffer;

	for (let i = 0; i * METADATA_BLOCK_SIZE < size; i++) {
		if (!metadataPieces[i]) {
			return false;
		}
	}

	return true;
}

function updateMetadataByPieces(engine, metadataPieces) {
	let metadata = Buffer.concat(metadataPieces);

	if (engine.infoHash !== sha1(metadata)) {
		metadataPieces = [];
		metadata = null;
	}

	engine.metadata = metadata;
}

function handleRequest(wire, channel, metadata) {
	const piece = message.piece;

	if (!metadata) {
		wire.extended(channel, {
			msg_type: 2,
			piece: piece
		});
	} else {
		const offset = piece * METADATA_BLOCK_SIZE;
		const metadataBuffer = metadata.slice(offset, offset + METADATA_BLOCK_SIZE);
		const extendMessageBuffer = bncode.encode({
			msg_type: 1,
			piece: piece
		});

		wire.extended(channel, Buffer.concat([extendMessageBuffer, metadataBuffer]));
	}
}

function handleReject() {
	console.log('extended message type REJECT');
}


function sendRequestsForPieces(wire, channel, pieceIndexes) {
	pieceIndexes.forEach((index) => {
		wire.extended(channel, {
			msg_type: 0,
			piece: index
		});
	});
}

function getUnhandledPieceIndexes(metadataPieces, size) {
	let pieces = [];

	for (let i = 0; i * METADATA_BLOCK_SIZE < size; i++) {
		if (!metadataPieces[i]) {
			pieces.push(i);
		}
	}

	return pieces;
}

function handleExtendedMessage(engine, data, wire, metadata, metadataPieces, channel, message) {
	const piece = message.piece;

	if (piece < 0) {
		return false;
	}

	switch (message.msg_type) {
		case MSG_TYPE.REQUEST:
			handleRequest(wire, channel, message);
			break;
		case MSG_TYPE.DATA:
			const delimiter = data.toString('ascii').indexOf('ee');
			const pieceBuffer = data.slice(delimiter + 2);

			if (handleData(metadata, size, metadataPieces, message.piece, pieceBuffer)) {
				updateMetadataByPieces(engine, metadataPieces);
				return true;
			}

			break;
		case MSG_TYPE.REJECT:
			handleReject();
			break;
	}

	return false;
}

module.exports = (engine, callback) => {
	let metadataPieces = [];

	return (wire) => {
		handleHandshake(wire)
			.then((handshakeData) => {
				const channel = handshakeData['m']['ut_metadata'];
				const size = handshakeData['metadata_size'];

				handleExtended(wire, (id, data) => {
					if (id !== EXTENSIONS.m.ut_metadata) {
						return;
					}

					parseExtendedMessage(data)
						.then(handleExtendedMessage.bind(engine, data, wire, metadata, metadataPieces, channel))
						.then((result) => {
							if (result) {
								callback(engine.metadata);
							}
						}, (err) => {
							console.error('handling message', err);
						});
				});

				const sizeGraterThanMax = size > METADATA_MAX_SIZE;

				if (sizeGraterThanMax || !size || metadata) {
					return;
				}

				sendRequestsForPieces(wire, channel, getUnhandledPieceIndexes(metadataPieces, size));
			}, (err) => {
				console.error('handshake err', err);
			});

		const metadata = engine.metadata;

		if (!wire.peerExtensions.extended) {
			return;
		}

		if (metadata) {
			wire.extended(0, {
				m: {
					ut_metadata: 1
				},
				metadata_size: metadata.length
			});
		} else {
			wire.extended(0, {
				m: {
					ut_metadata: 1
				}
			});
		}
	}
};
