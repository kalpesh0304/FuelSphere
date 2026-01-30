const cds = require('@sap/cds');
const path = require('path');
const express = require('express');

cds.on('bootstrap', (app) => {
    const airportsPath = path.join(__dirname, '..', 'app', 'airports', 'webapp');

    // Serve airports webapp at multiple paths for compatibility
    app.use('/airports/webapp', express.static(airportsPath));
    app.use('/airports', express.static(airportsPath));

    // Redirect root airports requests to index.html
    app.get('/airports', (req, res, next) => {
        if (!req.path.includes('.')) {
            res.sendFile(path.join(airportsPath, 'index.html'));
        } else {
            next();
        }
    });
});

module.exports = cds.server;
