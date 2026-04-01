/* FuelSphere Admin Portal — app.js */
(function () {
    'use strict';

    // DateTime
    function updateDateTime() {
        var el = document.getElementById('datetime');
        if (el) el.textContent = new Date().toLocaleString('en-CA', {
            weekday: 'short', year: 'numeric', month: 'short',
            day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    }
    updateDateTime();
    setInterval(updateDateTime, 60000);

    // OData helper
    async function odata(url) {
        try {
            var res = await fetch(url);
            if (!res.ok) throw new Error(res.statusText);
            var json = await res.json();
            return json.value || json;
        } catch (e) {
            console.error('OData error:', url, e);
            return [];
        }
    }

    function setText(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = val != null ? val : '--';
    }

    // Load cross-app KPIs
    async function loadKPIs() {
        var [flights, orders, invoices] = await Promise.all([
            odata('/odata/v4/orders/FlightSchedule?$filter=status eq \'SCHEDULED\' or status eq \'DEPARTED\'&$top=500'),
            odata('/odata/v4/orders/FuelOrders?$top=500'),
            odata('/odata/v4/invoice/Invoices?$top=500')
        ]);

        // Active flights (SCHEDULED or DEPARTED)
        setText('kpiFlights', flights.length);

        // Open fuel orders (not Completed/Cancelled)
        var openOrders = orders.filter(function(o) {
            return o.status !== 'Completed' && o.status !== 'Cancelled';
        });
        setText('kpiOrders', openOrders.length);

        // Pending deliveries (InProgress orders)
        var pending = orders.filter(function(o) { return o.status === 'InProgress'; });
        setText('kpiDeliveries', pending.length);

        // Invoices to process (not POSTED)
        var toProcess = invoices.filter(function(i) {
            return i.invoice_status !== 'POSTED' && i.invoice_status !== 'CANCELLED';
        });
        setText('kpiInvoices', toProcess.length);
    }

    loadKPIs();
})();
