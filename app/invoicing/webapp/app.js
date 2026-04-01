/* FuelSphere Invoicing App — app.js */
(function () {
    'use strict';

    var INVOICE_SVC = '/odata/v4/invoice';
    var ORDER_SVC = '/odata/v4/orders';

    function fmt(n) { return n == null ? '--' : Number(n).toLocaleString(); }
    function fmtCurrency(n, curr) {
        if (n == null) return '--';
        return (curr || 'USD') + ' ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function statusBadge(status) {
        if (!status) return '';
        var cls = {
            DRAFT: 'badge-draft', SUBMITTED: 'badge-submitted',
            VERIFIED: 'badge-verified', APPROVED: 'badge-approved',
            POSTED: 'badge-posted', REJECTED: 'badge-rejected',
            CANCELLED: 'badge-cancelled'
        };
        return '<span class="badge ' + (cls[status] || 'badge-draft') + '">' + status + '</span>';
    }

    function matchBadge(matchStatus) {
        if (!matchStatus) return '<span class="badge badge-match-partial">PENDING</span>';
        var cls = { MATCHED: 'badge-match-ok', PARTIAL: 'badge-match-partial', FAILED: 'badge-match-fail' };
        return '<span class="badge ' + (cls[matchStatus] || 'badge-match-partial') + '">' + matchStatus + '</span>';
    }

    function toleranceBadge(withinTolerance) {
        if (withinTolerance === true) return '<span class="badge badge-match-ok">OK</span>';
        if (withinTolerance === false) return '<span class="badge badge-match-fail">EXCEEDS</span>';
        return '<span class="badge badge-draft">N/A</span>';
    }

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

    async function loadDashboard() {
        var [invoices, matches, orders, deliveries] = await Promise.all([
            odata(INVOICE_SVC + '/Invoices?$orderby=invoice_date desc&$top=500'),
            odata(INVOICE_SVC + '/InvoiceMatches?$top=500'),
            odata(ORDER_SVC + '/FuelOrders?$top=500'),
            odata(ORDER_SVC + '/FuelDeliveries?$top=500')
        ]);

        // KPIs
        setText('kpiTotal', invoices.length);
        setText('kpiPending', invoices.filter(function(i) { return i.invoice_status !== 'POSTED' && i.invoice_status !== 'CANCELLED'; }).length);
        setText('kpiPosted', invoices.filter(function(i) { return i.invoice_status === 'POSTED'; }).length);

        // Exception count (invoices with tolerance exceeded or match issues)
        var exceptions = invoices.filter(function(i) {
            return i.invoice_status === 'SUBMITTED' || i.invoice_status === 'DRAFT';
        });
        setText('kpiExceptions', exceptions.length);

        // Three-way match counts
        var poCount = orders.filter(function(o) { return o.s4_po_number; }).length;
        var grCount = deliveries.length;
        var invCount = invoices.length;
        setText('matchPO', poCount);
        setText('matchGR', grCount);
        setText('matchINV', invCount);

        // Update match connectors
        var matchedCount = matches.filter(function(m) { return m.match_status === 'MATCHED'; }).length;
        if (matchedCount > 0) {
            var pogr = document.getElementById('matchPOGR');
            var grinv = document.getElementById('matchGRINV');
            if (pogr) pogr.style.background = '#107E3E';
            if (grinv) grinv.style.background = '#107E3E';
        }

        // Invoice table
        var tbody = document.getElementById('invoicesBody');
        if (tbody) {
            if (invoices.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="loading">No invoices found</td></tr>';
            } else {
                tbody.innerHTML = invoices.map(function(inv) {
                    var match = matches.find(function(m) { return m.invoice_ID === inv.ID; });
                    var matchStatus = match ? match.match_status : null;
                    var withinTol = match ? match.within_tolerance : null;
                    return '<tr>' +
                        '<td><strong>' + (inv.invoice_number || '--') + '</strong></td>' +
                        '<td>' + (inv.supplier_name || '--') + '</td>' +
                        '<td>' + (inv.invoice_date || '--') + '</td>' +
                        '<td>' + fmtCurrency(inv.total_amount, inv.currency_code) + '</td>' +
                        '<td>' + (inv.currency_code || '--') + '</td>' +
                        '<td>' + statusBadge(inv.invoice_status) + '</td>' +
                        '<td>' + matchBadge(matchStatus) + '</td>' +
                        '<td>' + toleranceBadge(withinTol) + '</td>' +
                        '</tr>';
                }).join('');
            }
        }

        // Exception queue
        var exQueue = document.getElementById('exceptionQueue');
        var exCount = document.getElementById('exceptionCount');
        if (exQueue) {
            if (exceptions.length === 0) {
                exQueue.innerHTML = '<div class="loading">No exceptions - all clear.</div>';
                if (exCount) exCount.textContent = '0 items';
            } else {
                if (exCount) exCount.textContent = exceptions.length + ' item' + (exceptions.length > 1 ? 's' : '');
                exQueue.innerHTML = exceptions.map(function(inv) {
                    return '<div class="exception-card">' +
                        '<div class="exception-invoice">' + (inv.invoice_number || '--') + '</div>' +
                        '<div class="exception-type">' + (inv.invoice_status || '--') + '</div>' +
                        '<div class="exception-msg">Requires verification - ' + fmtCurrency(inv.total_amount, inv.currency_code) + '</div>' +
                        '<div class="exception-action"><a href="/$fiori-preview/InvoiceService/Invoices#preview-app" target="_blank" class="btn btn-secondary">Review</a></div>' +
                        '</div>';
                }).join('');
            }
        }
    }

    loadDashboard();
})();
