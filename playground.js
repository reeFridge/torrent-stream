const torrentStream = require('./');

const URI = 'magnet:?xt=urn:btih:BF3BEA484A7C92AA6E95F86FE757A1ED04014BB9';
const engine = torrentStream(URI);

engine.on('ready', () => {
	engine.files.forEach((file) => {
		console.log('filename:', file.name);
	});
});
