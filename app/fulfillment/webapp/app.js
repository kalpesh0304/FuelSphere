/* FuelSphere Fulfillment App — app.js */
(function () {
    'use strict';

    var REFUELER_SVC = '/odata/v4/refueler';
    var ORDER_SVC = '/odata/v4/orders';

    function fmt(n) { return n == null ? '--' : Number(n).toLocaleString(); }
    function fmtDate(d) {
        if (!d) return '--';
        var dt = new Date(d);
        return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function statusBadge(status) {
        if (!status) return '<span class="badge badge-closed">Unknown</span>';
        var cssClass = 'badge-' + status.toLowerCase().replace(/ /g, '_');
        return '<span class="badge ' + cssClass + '">' + status.replace(/_/g, ' ') + '</span>';
    }

    function setText(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = val != null ? val : '--';
    }

    // DateTime
    function updateDateTime() {
        var el = document.getElementById('datetime');
        if (el) el.textContent = new Date().toLocaleString('en-US', {
            weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }
    updateDateTime();
    setInterval(updateDateTime, 60000);

    var pipelineStatuses = ['RECEIVED', 'CONFIRMED', 'SCHEDULED', 'IN_DELIVERY', 'DELIVERED', 'INVOICED'];

    async function loadDashboard() {
        var salesOrders = [];
        var tickets = [];

        try {
            var res = await fetch(REFUELER_SVC + '/SalesOrders?$orderby=status');
            if (res.ok) {
                var data = await res.json();
                salesOrders = data.value || [];
            }
        } catch (e) { console.error('Failed to load sales orders:', e); }

        try {
            var res2 = await fetch(ORDER_SVC + '/FuelTickets?$top=500');
            if (res2.ok) {
                var data2 = await res2.json();
                tickets = data2.value || [];
            }
        } catch (e) { console.error('Failed to load tickets:', e); }

        // Pipeline counts
        var counts = {};
        pipelineStatuses.forEach(function(s) { counts[s] = 0; });
        salesOrders.forEach(function(o) { if (counts.hasOwnProperty(o.status)) counts[o.status]++; });
        setText('countReceived', counts['RECEIVED']);
        setText('countConfirmed', counts['CONFIRMED']);
        setText('countScheduled', counts['SCHEDULED']);
        setText('countInDelivery', counts['IN_DELIVERY']);
        setText('countDelivered', counts['DELIVERED']);
        setText('countInvoiced', counts['INVOICED']);

        // KPIs
        var active = salesOrders.filter(function(o) { return o.status !== 'INVOICED' && o.status !== 'CANCELLED'; }).length;
        var scheduled = counts['SCHEDULED'];
        var ticketsPending = salesOrders.filter(function(o) { return o.status === 'DELIVERED'; }).length;
        var completed = counts['DELIVERED'] + counts['INVOICED'];
        setText('kpiOrders', active);
        setText('kpiScheduled', scheduled);
        setText('kpiTickets', ticketsPending);
        setText('kpiCompleted', completed);

        // Ticket generation cards
        var ticketGrid = document.getElementById('ticketGrid');
        if (ticketGrid) {
            if (tickets.length === 0) {
                // Show deliveries that need tickets
                var deliveries = [];
                try {
                    var res3 = await fetch(ORDER_SVC + '/FuelDeliveries?$top=20');
                    if (res3.ok) {
                        var data3 = await res3.json();
                        deliveries = data3.value || [];
                    }
                } catch (e) {}

                if (deliveries.length === 0) {
                    ticketGrid.innerHTML = '<div class="loading">No delivery records or tickets found.</div>';
                } else {
                    ticketGrid.innerHTML = deliveries.map(function(d) {
                        return '<div class="ticket-card">' +
                            '<div class="ticket-header">' +
                                '<span class="ticket-number">' + (d.epod_number || 'EPD-???') + '</span>' +
                                '<span class="ticket-status">' + statusBadge(d.delivery_status || 'PENDING') + '</span>' +
                            '</div>' +
                            '<div class="ticket-details">' +
                                '<strong>Delivered:</strong> ' + fmt(d.delivered_quantity_kg) + ' kg<br>' +
                                '<strong>Density:</strong> ' + (d.density_kg_l || '--') + ' kg/L<br>' +
                                '<strong>Temp:</strong> ' + (d.temperature_c || '--') + ' C' +
                            '</div>' +
                            '<div class="ticket-actions">' +
                                '<a href="/$fiori-preview/FuelOrderService/FuelDeliveries#preview-app" target="_blank" class="btn btn-secondary">View ePOD</a>' +
                            '</div>' +
                            '</div>';
                    }).join('');
                }
            } else {
                ticketGrid.innerHTML = tickets.map(function(t) {
                    return '<div class="ticket-card">' +
                        '<div class="ticket-header">' +
                            '<span class="ticket-number">' + (t.ticket_number || '--') + '</span>' +
                            '<span class="ticket-status">' + statusBadge(t.ticket_status || 'SIGNED') + '</span>' +
                        '</div>' +
                        '<div class="ticket-details">' +
                            '<strong>Qty:</strong> ' + fmt(t.ticket_quantity_kg) + ' kg<br>' +
                            '<strong>Density:</strong> ' + (t.density_at_15c || '--') + ' kg/L<br>' +
                            '<strong>Product:</strong> ' + (t.product_code || '--') +
                        '</div>' +
                        '<div class="ticket-actions">' +
                            '<a href="/$fiori-preview/FuelOrderService/FuelTickets#preview-app" target="_blank" class="btn btn-secondary">View Ticket</a>' +
                        '</div>' +
                        '</div>';
                }).join('');
            }
        }

        // Sales orders table
        var tbody = document.getElementById('salesOrdersBody');
        if (tbody) {
            if (salesOrders.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="loading">No sales orders found.</td></tr>';
            } else {
                tbody.innerHTML = salesOrders.map(function(o) {
                    return '<tr>' +
                        '<td><strong>' + (o.sales_order_number || '--') + '</strong></td>' +
                        '<td>' + (o.customer_airline || '--') + '</td>' +
                        '<td>' + (o.flight_number || '--') + '</td>' +
                        '<td>' + (o.station_code || '--') + '</td>' +
                        '<td>' + fmt(o.estimated_quantity) + '</td>' +
                        '<td>' + fmt(o.delivered_quantity) + '</td>' +
                        '<td>' + statusBadge(o.status) + '</td>' +
                        '<td>' + fmtDate(o.scheduled_date) + '</td>' +
                        '</tr>';
                }).join('');
            }
        }
    }

    // Persona filtering
    function initPersona() {
        var selector = document.getElementById('personaSelector');
        if (!selector) return;
        selector.addEventListener('change', function() {
            applyPersona(selector.value);
        });
    }

    function applyPersona(persona) {
        var ticketSection = document.querySelector('.ticket-section');
        var uomSection = document.querySelector('.uom-section');
        var photoCard = document.querySelector('.photo-upload-placeholder');
        var pipelineSection = document.querySelector('.pipeline-section');

        // Reset all visible
        [ticketSection, uomSection, pipelineSection].forEach(function(el) {
            if (el) el.style.display = '';
        });
        if (photoCard) photoCard.closest('.table-card').style.display = '';

        if (persona === 'supplier') {
            // Supplier Planner: focus on pipeline + orders, hide ticket/photo details
            if (ticketSection) ticketSection.style.display = 'none';
            if (photoCard) photoCard.closest('.table-card').style.display = 'none';
        } else if (persona === 'delivery') {
            // Delivery Crew: focus on tickets + photo + UoM, hide pipeline overview
            if (pipelineSection) pipelineSection.style.display = 'none';
        }
    }

    loadDashboard();
    initPersona();
})();
