const cds = require('@sap/cds');
const path = require('path');

cds.on('bootstrap', (app) => {
    const express = require('express');
    const airportsPath = path.join(__dirname, '..', 'app', 'airports', 'webapp');

    // Serve static files for airports app
    app.use('/airports', express.static(airportsPath, { index: 'index.html' }));
});

module.exports = cds.server;
