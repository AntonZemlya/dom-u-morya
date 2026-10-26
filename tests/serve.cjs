const {server} = require('./helpers.cjs');
// Preview needs only built-in Node modules; keep Playwright optional for npm run dev.
server(undefined, Number(process.env.PORT || 4173)).then(s => console.log('Local: '+s.url));
