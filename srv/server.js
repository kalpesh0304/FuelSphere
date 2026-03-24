const cds = require('@sap/cds');
const express = require('express');
const path = require('path');

// Serve static files BEFORE CDS middleware
cds.on('bootstrap', (app) => {
    const appFolder = path.join(__dirname, '..', 'app');
    console.log('[server.js] Registering static middleware for:', appFolder);

    // Serve airline dashboard at /airline
    app.use('/airline', express.static(path.join(appFolder, 'airline', 'webapp')));

    // Serve refueler dashboard at /refueler
    app.use('/refueler', express.static(path.join(appFolder, 'refueler', 'webapp')));

    // Serve entire app folder at root as fallback
    app.use(express.static(appFolder));

    console.log('[server.js] Static middleware registered: /airline, /refueler');
});

module.exports = cds.server;
