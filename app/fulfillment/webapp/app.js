/* FuelSphere Fulfillment App — app.js */
(function () {
    'use strict';

    var REFUELER_SVC = '/odata/v4/refueler';
    var ORDER_SVC = '/odata/v4/orders';
    var currentPersona = 'all';

    function fmt(n) { return n == null ? '--' : Number(n).toLocaleString(); }
    function fmtDate(d) {
        if (!d) return '--';
        var dt = new Date(d);
        return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    function fmtTime(t) {
        if (!t) return '';
        return t.substring(0, 5);
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

    var pipelineStatuses = ['RECEIVED', 'CONFIRMED', 'SCHEDULED', 'DELIVERED', 'INVOICED', 'CLOSED'];

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

    async function loadDashboard() {
        var salesOrders = await odata(REFUELER_SVC + '/SalesOrders?$orderby=scheduled_date desc');
        var deliveries = await odata(ORDER_SVC + '/FuelDeliveries?$top=500');
        var tickets = await odata(ORDER_SVC + '/FuelTickets?$top=500');

        // Pipeline counts
        var counts = {};
        pipelineStatuses.forEach(function(s) { counts[s] = 0; });
        salesOrders.forEach(function(o) { if (counts.hasOwnProperty(o.status)) counts[o.status]++; });
        setText('countReceived', counts['RECEIVED']);
        setText('countConfirmed', counts['CONFIRMED']);
        setText('countScheduled', counts['SCHEDULED']);
        setText('countDelivered', counts['DELIVERED']);
        setText('countInvoiced', counts['INVOICED']);
        setText('countClosed', counts['CLOSED']);

        // KPIs
        var active = salesOrders.filter(function(o) {
            return o.status !== 'INVOICED' && o.status !== 'CLOSED' && o.status !== 'CANCELLED';
        }).length;
        var scheduled = counts['SCHEDULED'];
        var ticketsPending = deliveries.filter(function(d) {
            // Deliveries without a matching ticket
            var hasTicket = tickets.some(function(t) { return t.delivery_ID === d.ID; });
            return !hasTicket && d.status !== 'Cancelled';
        }).length;
        var completed = counts['DELIVERED'] + counts['INVOICED'] + counts['CLOSED'];
        setText('kpiOrders', active);
        setText('kpiScheduled', scheduled);
        setText('kpiTicketsPending', ticketsPending);
        setText('kpiCompleted', completed);

        // Ticket / ePOD cards — combine deliveries and tickets
        renderTicketCards(deliveries, tickets, salesOrders);

        // Sales orders table
        renderSalesOrders(salesOrders);

        // Apply persona visibility
        applyPersona(currentPersona);
    }

    function renderTicketCards(deliveries, tickets, salesOrders) {
        var ticketGrid = document.getElementById('ticketGrid');
        if (!ticketGrid) return;

        if (deliveries.length === 0 && tickets.length === 0) {
            ticketGrid.innerHTML = '<div class="loading">No delivery records or tickets found.</div>';
            return;
        }

        var html = '';

        // Show deliveries with their ticket status
        deliveries.forEach(function(d) {
            var ticket = tickets.find(function(t) { return t.delivery_ID === d.ID; });
            var ticketStatus = ticket ? ticket.status : 'No Ticket';
            var ticketNumber = ticket ? ticket.ticket_number : null;
            var isPosted = d.status === 'Posted' || (ticket && ticket.status === 'Closed');
            var isPending = !ticket;

            // Find matching sales order for flight info
            var so = salesOrders.find(function(s) { return s.purchase_order_ID === d.order_ID; });
            var flightNum = so ? so.flight_number : '';
            var station = so ? so.station_code : '';

            html += '<div class="ticket-card' + (isPending ? ' ticket-card-pending' : '') + (isPosted ? ' ticket-card-posted' : '') + '">' +
                '<div class="ticket-header">' +
                    '<div class="ticket-id">' +
                        '<span class="ticket-number">' + (d.delivery_number || d.epod_number || 'EPD-???') + '</span>' +
                        (flightNum ? '<span class="ticket-flight">' + flightNum + ' @ ' + station + '</span>' : '') +
                    '</div>' +
                    '<span class="ticket-status">' + statusBadge(d.status || 'Pending') + '</span>' +
                '</div>' +
                '<div class="ticket-details">' +
                    '<div class="ticket-detail-row"><span class="detail-label">Delivered</span><span class="detail-value">' + fmt(d.delivered_quantity) + ' kg</span></div>' +
                    '<div class="ticket-detail-row"><span class="detail-label">Density</span><span class="detail-value">' + (d.density || '--') + ' kg/L</span></div>' +
                    '<div class="ticket-detail-row"><span class="detail-label">Temp</span><span class="detail-value">' + (d.temperature || '--') + ' °C</span></div>' +
                    '<div class="ticket-detail-row"><span class="detail-label">Vehicle</span><span class="detail-value">' + (d.vehicle_id || '--') + '</span></div>' +
                    '<div class="ticket-detail-row"><span class="detail-label">Driver</span><span class="detail-value">' + (d.driver_name || '--') + '</span></div>' +
                    '<div class="ticket-detail-row"><span class="detail-label">Pilot</span><span class="detail-value">' + (d.pilot_name || '--') + '</span></div>' +
                '</div>' +
                '<div class="ticket-footer">' +
                    (ticketNumber ?
                        '<div class="ticket-ref"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="#107E3E"/></svg> ' + ticketNumber + '</div>' :
                        '<div class="ticket-ref ticket-ref-pending"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="#E9730C"/></svg> Ticket needed</div>') +
                    (d.signature_timestamp ?
                        '<div class="ticket-signed"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" fill="#107E3E"/></svg> Signed</div>' :
                        '<div class="ticket-signed ticket-unsigned">Awaiting signature</div>') +
                '</div>' +
            '</div>';
        });

        // If no deliveries but tickets exist, show tickets directly
        if (deliveries.length === 0) {
            tickets.forEach(function(t) {
                html += '<div class="ticket-card ticket-card-posted">' +
                    '<div class="ticket-header">' +
                        '<span class="ticket-number">' + (t.ticket_number || '--') + '</span>' +
                        '<span class="ticket-status">' + statusBadge(t.status || 'Signed') + '</span>' +
                    '</div>' +
                    '<div class="ticket-details">' +
                        '<div class="ticket-detail-row"><span class="detail-label">Qty</span><span class="detail-value">' + fmt(t.quantity) + ' kg</span></div>' +
                        '<div class="ticket-detail-row"><span class="detail-label">Flight</span><span class="detail-value">' + (t.flight_number || '--') + '</span></div>' +
                        '<div class="ticket-detail-row"><span class="detail-label">Aircraft</span><span class="detail-value">' + (t.aircraft_reg || '--') + '</span></div>' +
                    '</div>' +
                '</div>';
            });
        }

        ticketGrid.innerHTML = html;
    }

    function renderSalesOrders(salesOrders) {
        var tbody = document.getElementById('salesOrdersBody');
        if (!tbody) return;

        if (salesOrders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="loading">No sales orders found.</td></tr>';
            return;
        }

        tbody.innerHTML = salesOrders.map(function(o) {
            var vehicleDriver = '';
            if (o.vehicle_id || o.driver_name) {
                vehicleDriver = (o.vehicle_id || '--') + '<br><span class="driver-name">' + (o.driver_name || '--') + '</span>';
            } else {
                vehicleDriver = '<span class="text-muted">Not assigned</span>';
            }

            return '<tr class="so-row-' + (o.status || '').toLowerCase() + '">' +
                '<td><strong>' + (o.sales_order_number || '--') + '</strong></td>' +
                '<td>' + (o.customer_airline || '--') + '</td>' +
                '<td>' + (o.flight_number || '--') + '</td>' +
                '<td>' + (o.station_code || '--') + '</td>' +
                '<td class="qty-cell">' + fmt(o.estimated_quantity) + '</td>' +
                '<td class="qty-cell">' + (o.delivered_quantity ? fmt(o.delivered_quantity) : '<span class="text-muted">--</span>') + '</td>' +
                '<td>' + statusBadge(o.status) + '</td>' +
                '<td>' + fmtDate(o.scheduled_date) + (o.scheduled_time ? '<br>' + fmtTime(o.scheduled_time) : '') + '</td>' +
                '<td>' + vehicleDriver + '</td>' +
                '</tr>';
        }).join('');
    }

    // Persona filtering — controls what each role can see
    function initPersona() {
        var selector = document.getElementById('personaSelector');
        if (!selector) return;
        selector.addEventListener('change', function() {
            currentPersona = selector.value;
            applyPersona(currentPersona);
        });
    }

    function applyPersona(persona) {
        var pipelineSection = document.getElementById('pipelineSection');
        var kpiSection = document.getElementById('kpiSection');
        var workflowSection = document.getElementById('workflowSection');
        var ticketSection = document.getElementById('ticketSection');
        var photoSection = document.getElementById('photoSection');
        var uomSection = document.getElementById('uomSection');
        var salesOrderSection = document.getElementById('salesOrderSection');

        // Reset all visible
        [pipelineSection, kpiSection, workflowSection, ticketSection, photoSection, uomSection, salesOrderSection].forEach(function(el) {
            if (el) el.style.display = '';
        });

        if (persona === 'supplier') {
            // Supplier Planner: sees everything (full page)
            // All sections visible — no changes needed
        } else if (persona === 'delivery') {
            // Delivery Crew: ticket + photo only (mobile-optimized)
            if (pipelineSection) pipelineSection.style.display = 'none';
            if (kpiSection) kpiSection.style.display = 'none';
            if (workflowSection) workflowSection.style.display = 'none';
            if (uomSection) uomSection.style.display = 'none';
            if (salesOrderSection) salesOrderSection.style.display = 'none';
            // ticketSection and photoSection remain visible
        }
        // 'all' — everything visible
    }

    // Photo upload handler
    function initPhotoUpload() {
        var captureBtn = document.getElementById('photoCaptureBtn');
        var fileInput = document.getElementById('photoFile');
        var uploadArea = document.getElementById('photoUploadArea');
        var previewGrid = document.getElementById('photoPreviewGrid');
        if (!captureBtn || !fileInput) return;

        captureBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            fileInput.click();
        });
        uploadArea.addEventListener('click', function() { fileInput.click(); });

        // Drag & drop
        uploadArea.addEventListener('dragover', function(e) { e.preventDefault(); uploadArea.classList.add('drag-over'); });
        uploadArea.addEventListener('dragleave', function() { uploadArea.classList.remove('drag-over'); });
        uploadArea.addEventListener('drop', function(e) {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
            handlePhotos(e.dataTransfer.files);
        });

        fileInput.addEventListener('change', function() {
            if (fileInput.files.length > 0) handlePhotos(fileInput.files);
        });

        function handlePhotos(files) {
            if (!previewGrid) return;
            for (var i = 0; i < files.length; i++) {
                var file = files[i];
                if (!file.type.startsWith('image/')) continue;
                var reader = new FileReader();
                reader.onload = (function(f) {
                    return function(e) {
                        var div = document.createElement('div');
                        div.className = 'photo-preview-item';
                        div.innerHTML = '<img src="' + e.target.result + '" alt="Delivery evidence">' +
                            '<div class="photo-preview-name">' + f.name + '</div>' +
                            '<div class="photo-preview-time">' + new Date().toLocaleTimeString() + '</div>';
                        previewGrid.appendChild(div);
                    };
                })(file);
                reader.readAsDataURL(file);
            }
        }
    }

    function init() {
        loadDashboard();
        initPersona();
        initPhotoUpload();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
