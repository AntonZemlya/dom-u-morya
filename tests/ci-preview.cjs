// Separate process: synchronous test runners must not block the preview's event loop.
const {server,root}=require('./helpers.cjs');
server(require('node:path').join(root,'dist')).then(site=>{
 console.log(site.url);
 const close=async()=>{await site.close();process.exit(0)};
 process.on('SIGTERM',close);process.on('SIGINT',close);
}).catch(error=>{console.error(error);process.exit(1)});
