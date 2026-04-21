// Single-cycle runner for GitHub Actions cron
// Same as oracle-daemon.js but exits after one poll cycle
process.env._HTP_ONCE = 'true';
const originalSetInterval = global.setInterval;
global.setInterval = () => {}; // disable the recurring loop

require('./oracle-daemon.js');
setTimeout(() => process.exit(0), 60000); // safety exit after 60s
