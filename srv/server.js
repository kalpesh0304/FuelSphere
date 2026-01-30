const cds = require('@sap/cds');
const express = require('express');
const path = require('path');

cds.on('bootstrap', (app) => {
    // Serve static files from app folder
    app.use('/airports', express.static(path.join(__dirname, '..', 'app', 'airports')));
});

module.exports = cds.server;
