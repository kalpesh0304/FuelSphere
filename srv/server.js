const cds = require('@sap/cds');
const express = require('express');
const path = require('path');

// Serve static files BEFORE CDS middleware
cds.on('bootstrap', (app) => {
    const appFolder = path.join(__dirname, '..', 'app');
    console.log('[server.js] Registering static middleware for:', appFolder);

    // Serve entire app folder at root - this allows /airports/webapp/* to work
    app.use(express.static(appFolder));

    // Also explicitly serve airports at /airports path
    app.use('/airports', express.static(path.join(appFolder, 'airports')));

    console.log('[server.js] Static middleware registered');
});

module.exports = cds.server;
