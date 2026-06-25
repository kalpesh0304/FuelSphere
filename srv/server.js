const cds = require('@sap/cds');
const express = require('express');
const path = require('path');

// Serve static files BEFORE CDS middleware
cds.on('bootstrap', (app) => {
    const appFolder = path.join(__dirname, '..', 'app');
    console.log('[server.js] Registering static middleware for:', appFolder);

    // New 4-app architecture + Admin portal
    app.use('/admin', express.static(path.join(appFolder, 'admin', 'webapp')));
    app.use('/operations', express.static(path.join(appFolder, 'operations', 'webapp')));
    app.use('/planning', express.static(path.join(appFolder, 'planning', 'webapp')));
    app.use('/fulfillment', express.static(path.join(appFolder, 'fulfillment', 'webapp')));
    app.use('/invoicing', express.static(path.join(appFolder, 'invoicing', 'webapp')));

    // Serve entire app folder at root as fallback
    app.use(express.static(appFolder));

    console.log('[server.js] Static middleware registered: /admin, /operations, /planning, /fulfillment, /invoicing');
});

module.exports = cds.server;
