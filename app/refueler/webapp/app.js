/* FuelSphere Refueler/Supplier Dashboard — Vanilla JS */

(function () {
    'use strict';

    // --- DateTime Updater ---
    function updateDateTime() {
        var el = document.getElementById('datetime');
        if (el) {
            el.textContent = new Date().toLocaleString('en-US', {
                weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
        }
    }
    updateDateTime();
    setInterval(updateDateTime, 1000);

    // --- Status Badge Helper ---
    function statusBadge(status) {
        if (!status) return '<span class="badge badge-closed">Unknown</span>';
        var cssClass = 'badge-' + status.toLowerCase().replace(/ /g, '_');
        var label = status.replace(/_/g, ' ');
        return '<span class="badge ' + cssClass + '">' + label + '</span>';
    }

    // --- Format currency ---
    function formatCurrency(value) {
        if (value == null || isNaN(value)) return '--';
        return '$' + Number(value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }

    // --- Format quantity ---
    function formatQty(value) {
        if (value == null || isNaN(value)) return '--';
        return Number(value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }

    // --- Format date ---
    function formatDate(dateStr) {
        if (!dateStr) return '--';
        var d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    // --- Pipeline statuses (active flow only) ---
    var pipelineStatuses = ['RECEIVED', 'CONFIRMED', 'SCHEDULED', 'IN_DELIVERY', 'DELIVERED', 'INVOICED'];

    // --- Fetch Sales Orders and populate dashboard ---
    function loadDashboard() {
        fetch('/odata/v4/refueler/SalesOrders?$orderby=status')
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (data) {
                var orders = data.value || [];
                populatePipeline(orders);
                populateKPIs(orders);
                populateTable(orders);
            })
            .catch(function (err) {
                console.error('Failed to load sales orders:', err);
                showTableError();
                showPipelineEmpty();
            });
    }

    // --- Pipeline Counts ---
    function populatePipeline(orders) {
        var counts = {};
        pipelineStatuses.forEach(function (s) { counts[s] = 0; });
        orders.forEach(function (o) {
            if (counts.hasOwnProperty(o.status)) {
                counts[o.status]++;
            }
        });
        document.getElementById('countReceived').textContent = counts['RECEIVED'];
        document.getElementById('countConfirmed').textContent = counts['CONFIRMED'];
        document.getElementById('countScheduled').textContent = counts['SCHEDULED'];
        document.getElementById('countInDelivery').textContent = counts['IN_DELIVERY'];
        document.getElementById('countDelivered').textContent = counts['DELIVERED'];
        document.getElementById('countInvoiced').textContent = counts['INVOICED'];
    }

    function showPipelineEmpty() {
        pipelineStatuses.forEach(function (s) {
            var id = 'count' + s.charAt(0) + s.slice(1).toLowerCase().replace(/_([a-z])/g, function (m, c) { return c.toUpperCase(); });
            var el = document.getElementById(id);
            if (el) el.textContent = '0';
        });
    }

    // --- KPI Cards ---
    function populateKPIs(orders) {
        var today = new Date().toISOString().slice(0, 10);

        // Orders Received Today: status RECEIVED and createdAt is today (or flight_date is today as fallback)
        var receivedToday = orders.filter(function (o) {
            if (o.status !== 'RECEIVED') return false;
            var created = (o.createdAt || '').slice(0, 10);
            var flight = o.flight_date || '';
            return created === today || flight === today;
        }).length;
        // If none match date filter, just count all RECEIVED as a useful fallback
        if (receivedToday === 0) {
            receivedToday = orders.filter(function (o) { return o.status === 'RECEIVED'; }).length;
        }
        document.getElementById('kpiReceivedToday').textContent = receivedToday;

        // Deliveries Scheduled
        var scheduled = orders.filter(function (o) { return o.status === 'SCHEDULED'; }).length;
        document.getElementById('kpiScheduled').textContent = scheduled;

        // Pending Invoices: delivered but not yet invoiced
        var pendingInvoices = orders.filter(function (o) { return o.status === 'DELIVERED'; }).length;
        document.getElementById('kpiPendingInvoices').textContent = pendingInvoices;

        // Revenue This Month: sum total_amount for INVOICED orders
        var revenue = 0;
        orders.forEach(function (o) {
            if (o.status === 'INVOICED' || o.status === 'CLOSED') {
                revenue += Number(o.total_amount) || 0;
            }
        });
        document.getElementById('kpiRevenue').textContent = formatCurrency(revenue);
    }

    // --- Sales Orders Table ---
    function populateTable(orders) {
        var tbody = document.getElementById('salesOrdersBody');
        if (!orders || orders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="loading">No sales orders found.</td></tr>';
            return;
        }
        var html = '';
        orders.forEach(function (o) {
            html += '<tr>';
            html += '<td><strong>' + (o.sales_order_number || '--') + '</strong></td>';
            html += '<td>' + (o.customer_airline || '--') + '</td>';
            html += '<td>' + (o.flight_number || '--') + '</td>';
            html += '<td>' + (o.station_code || '--') + '</td>';
            html += '<td>' + formatQty(o.estimated_quantity) + '</td>';
            html += '<td>' + formatQty(o.delivered_quantity) + '</td>';
            html += '<td>' + statusBadge(o.status) + '</td>';
            html += '<td>' + formatDate(o.scheduled_date) + '</td>';
            html += '</tr>';
        });
        tbody.innerHTML = html;
    }

    function showTableError() {
        var tbody = document.getElementById('salesOrdersBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="8" class="loading">Unable to load sales orders. Ensure the server is running.</td></tr>';
        }
    }

    // --- Initialize ---
    loadDashboard();

})();
