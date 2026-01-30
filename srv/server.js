const cds = require('@sap/cds');
const path = require('path');

cds.on('bootstrap', (app) => {
    // Serve airports webapp at /airports/
    const airportsPath = path.join(__dirname, '..', 'app', 'airports', 'webapp');
    app.use('/airports', require('express').static(airportsPath));

    // Also serve at /airports/webapp/ for compatibility
    app.use('/airports/webapp', require('express').static(airportsPath));
});

module.exports = cds.server;
