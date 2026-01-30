const cds = require('@sap/cds');
<<<<<<< HEAD
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
=======
const express = require('express');
const path = require('path');

cds.on('bootstrap', (app) => {
    // Serve static files from app folder
    app.use('/airports', express.static(path.join(__dirname, '..', 'app', 'airports')));
>>>>>>> main/claude/fix-airports-error-kymL7
});

module.exports = cds.server;
