/* FuelSphere Operations Dashboard — app.js */
(function () {
    'use strict';

    var ORDER_SVC = '/odata/v4/orders';
    var BURN_SVC = '/odata/v4/burn';
    var FUEL_ORDER_APP = 'https://glcmjmynl0mfp4nx.launchpad.cfapps.eu10.hana.ondemand.com/91d3cd79-fbcd-42e1-bb4b-591d8070935e.comfuelspherefuelorders.comfuelspherefuelorders-0.0.1/index.html';
    var currentPersona = 'all';

    function fuelOrderLink(orderNum) {
        if (!orderNum) return '--';
        return '<a href="' + FUEL_ORDER_APP + '" target="_blank" class="fo-link" title="Open in Fuel Orders app">' + orderNum + '</a>';
    }

    function fmt(n) { return n == null ? '--' : Number(n).toLocaleString(); }
    function fmtDec(n, d) { return n == null ? '--' : Number(n).toFixed(d || 2); }
    function fmtCurrency(n, cur) {
        if (n == null) return '--';
        return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + (cur || 'USD');
    }

    function statusBadge(status) {
        if (!status) return '<span class="badge badge-draft">--</span>';
        var cls = {
            Draft: 'badge-draft', Submitted: 'badge-submitted', Confirmed: 'badge-confirmed',
            InProgress: 'badge-inprogress', Delivered: 'badge-delivered', Completed: 'badge-completed',
            Cancelled: 'badge-cancelled', SCHEDULED: 'badge-scheduled', ARRIVED: 'badge-arrived',
            DEPARTED: 'badge-departed', PRELIMINARY: 'badge-submitted', ADJUSTED: 'badge-adjusted',
            CONFIRMED: 'badge-confirmed', REJECTED: 'badge-cancelled',
            NORMAL: 'badge-confirmed', WARNING: 'badge-submitted', EXCEPTION: 'badge-inprogress', CRITICAL: 'badge-cancelled'
        };
        return '<span class="badge ' + (cls[status] || 'badge-draft') + '">' + status + '</span>';
    }

    function crewBadge(status) {
        if (!status || status === 'PENDING') return '<span class="badge badge-pending">PENDING</span>';
        if (status === 'CONFIRMED') return '<span class="badge badge-confirmed">CONFIRMED</span>';
        if (status === 'ADJUSTED') return '<span class="badge badge-adjusted">ADJUSTED</span>';
        return '<span class="badge badge-draft">' + status + '</span>';
    }

    function varianceBadge(pct) {
        if (pct == null) return '--';
        var abs = Math.abs(pct);
        var cls = abs <= 2 ? 'variance-ok' : abs <= 5 ? 'variance-warn' : 'variance-error';
        var sign = pct >= 0 ? '+' : '';
        return '<span class="' + cls + '">' + sign + fmtDec(pct, 2) + '%</span>';
    }

    function robBar(pct) {
        if (pct == null) return '--';
        var cls = pct >= 50 ? 'rob-ok' : pct >= 25 ? 'rob-warn' : 'rob-low';
        return '<div class="rob-bar-wrap"><div class="rob-bar ' + cls + '" style="width:' + Math.min(pct, 100) + '%"></div><span class="rob-pct">' + fmtDec(pct, 1) + '%</span></div>';
    }

    function setText(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = val != null ? val : '--';
    }
    function setHTML(id, val) {
        var el = document.getElementById(id);
        if (el) el.innerHTML = val != null ? val : '--';
    }

    function updateDateTime() {
        var el = document.getElementById('datetime');
        if (el) el.textContent = new Date().toLocaleString('en-CA', {
            weekday: 'short', year: 'numeric', month: 'short',
            day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    }
    updateDateTime();
    setInterval(updateDateTime, 60000);

    function isPRFlight(f) {
        return f.airline_code === 'PR' || (f.flight_number && f.flight_number.substring(0, 2) === 'PR');
    }

    async function odata(url) {
        try {
            var res = await fetch(url);
            if (!res.ok) throw new Error(res.statusText);
            var json = await res.json();
            return json.value || json;
        } catch (e) { console.error('OData error:', url, e); return []; }
    }

    // Journey step calculation
    function journeyStep(order, deliveries, tickets) {
        if (!order) return 1;
        var delivery = deliveries.find(function(d) { return d.order_ID === order.ID; });
        var ticket = delivery ? tickets.find(function(t) { return t.delivery_ID === delivery.ID; }) : null;

        if (order.status === 'Completed' || (order.s4_po_number && ticket)) return 7;
        if (order.status === 'Delivered' || (delivery && ticket)) return 6;
        if (order.status === 'InProgress' || delivery) return 5;
        if (order.crew_review_status === 'CONFIRMED' || order.crew_review_status === 'ADJUSTED') return 4;
        if (order.status === 'Confirmed') return 3;
        if (order.status === 'Draft' || order.status === 'Submitted') return 2;
        return 1;
    }

    async function loadDashboard() {
        var [orders, flights, deliveries, tickets, dispatches, burns, robLedger] = await Promise.all([
            odata(ORDER_SVC + '/FuelOrders?$orderby=requested_date desc'),
            odata(ORDER_SVC + '/FlightSchedule?$orderby=flight_date desc,scheduled_departure asc'),
            odata(ORDER_SVC + '/FuelDeliveries?$top=500'),
            odata(ORDER_SVC + '/FuelTickets?$top=500'),
            odata(ORDER_SVC + '/FlightDispatches?$top=500'),
            odata(BURN_SVC + '/FuelBurns?$orderby=burn_date desc'),
            odata(BURN_SVC + '/ROBLedger?$orderby=record_date desc,sequence desc')
        ]);

        // Filter out PR flights
        var filteredFlights = flights.filter(function(f) { return !isPRFlight(f); });
        var allOrders = orders.filter(function(o) {
            var flight = flights.find(function(f) { return f.ID === o.flight_ID; });
            if (!flight) return true;
            return !isPRFlight(flight);
        });

        // ═══ Journey Step Counts ═══
        var stepCounts = [0, 0, 0, 0, 0, 0, 0];
        var flightsWithOrders = new Set(allOrders.map(function(o) { return o.flight_ID; }).filter(Boolean));
        // Step 1: Scheduled flights with no order
        var scheduledNoOrder = filteredFlights.filter(function(f) {
            return f.status === 'SCHEDULED' && !flightsWithOrders.has(f.ID);
        });
        stepCounts[0] = scheduledNoOrder.length;

        allOrders.forEach(function(o) {
            var step = journeyStep(o, deliveries, tickets);
            stepCounts[step - 1]++;
        });
        // Subtract step-1 orders counted above (flights with no order are step 1)
        // Orders at step 2+ are already counted; step 1 from scheduledNoOrder is separate
        for (var i = 0; i < 7; i++) {
            setText('step' + (i + 1) + 'Count', stepCounts[i]);
        }

        // ═══ KPIs ═══
        var active = allOrders.filter(function(o) {
            return o.status !== 'Cancelled' && o.status !== 'Completed';
        }).length;
        var pendingCrew = allOrders.filter(function(o) {
            return o.status === 'Confirmed' && (!o.crew_review_status || o.crew_review_status === 'PENDING');
        }).length;
        var inProgress = allOrders.filter(function(o) { return o.status === 'InProgress'; }).length;
        var completed = allOrders.filter(function(o) {
            return o.status === 'Delivered' || o.status === 'Completed';
        }).length;

        setText('kpiActiveOrders', active);
        setText('kpiCrewPending', pendingCrew);
        setText('kpiDeliveries', inProgress);
        setText('kpiCompleted', completed);

        // ═══ Fuel Order Lifecycle Table ═══
        renderOrdersTable(allOrders, flights, deliveries, tickets);

        // ═══ Burn Analysis ═══
        renderBurnAnalysis(burns, flights, robLedger);

        // ═══ ROB Fleet Dashboard ═══
        renderROBDashboard(robLedger);

        // ═══ Delivery Tracker ═══
        renderDeliveryTracker(deliveries, allOrders, flights, tickets);

        // ═══ Finance Summary ═══
        renderFinanceSummary(allOrders, flights);

        applyPersona(currentPersona);
    }

    // ═══ Orders Table ═══
    function renderOrdersTable(orders, flights, deliveries, tickets) {
        var tbody = document.getElementById('ordersBody');
        if (!tbody) return;
        if (orders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" class="loading">No fuel orders found</td></tr>';
            return;
        }
        tbody.innerHTML = orders.map(function(o) {
            var flight = flights.find(function(f) { return f.ID === o.flight_ID; });
            var route = flight ? (flight.origin_airport + ' \u2192 ' + flight.destination_airport) : '--';
            var flightNum = flight ? flight.flight_number : '--';
            var step = journeyStep(o, deliveries, tickets);

            // Delivery variance
            var delivery = deliveries.find(function(d) { return d.order_ID === o.ID; });
            var deliveredQty = delivery ? delivery.delivered_quantity : null;
            var variance = (deliveredQty && o.ordered_quantity) ?
                ((deliveredQty - o.ordered_quantity) / o.ordered_quantity * 100) : null;

            return '<tr class="order-row-step' + step + '">' +
                '<td>' + fuelOrderLink(o.order_number) + '</td>' +
                '<td><strong>' + flightNum + '</strong></td>' +
                '<td>' + route + '</td>' +
                '<td>' + (o.station_code || '--') + '</td>' +
                '<td class="num-cell">' + fmt(o.ordered_quantity) + '</td>' +
                '<td class="num-cell">' + (deliveredQty ? fmt(deliveredQty) : '<span class="text-muted">--</span>') + '</td>' +
                '<td class="num-cell">' + (variance != null ? varianceBadge(variance) : '<span class="text-muted">--</span>') + '</td>' +
                '<td>' + statusBadge(o.status) + '</td>' +
                '<td>' + crewBadge(o.crew_review_status) + '</td>' +
                '<td><span class="badge badge-step">Step ' + step + '</span></td>' +
                '</tr>';
        }).join('');
    }

    // ═══ Burn Analysis ═══
    function renderBurnAnalysis(burns, flights, robLedger) {
        // KPIs
        var totalBurn = 0, totalPlanned = 0, burnCount = 0, varianceRecords = 0;
        burns.forEach(function(b) {
            totalBurn += (b.actual_burn_kg || 0);
            totalPlanned += (b.planned_burn_kg || 0);
            burnCount++;
            if (Math.abs(b.variance_pct || 0) > 2) varianceRecords++;
        });
        var totalUplift = 0;
        robLedger.forEach(function(r) { totalUplift += (r.uplift_kg || 0); });

        setText('burnTotalKg', fmt(Math.round(totalBurn)));
        setText('burnAvgFlight', burnCount > 0 ? fmt(Math.round(totalBurn / burnCount)) : '--');
        setText('burnTotalUplift', fmt(Math.round(totalUplift)));
        setText('burnVarianceCount', varianceRecords);

        // Table
        var tbody = document.getElementById('burnBody');
        if (!tbody) return;
        if (burns.length === 0) {
            tbody.innerHTML = '<tr><td colspan="11" class="loading">No burn records found</td></tr>';
            return;
        }
        tbody.innerHTML = burns.map(function(b) {
            var flight = flights.find(function(f) { return f.ID === b.flight_ID; });
            var flightNum = flight ? flight.flight_number : '--';
            var origin = b.origin_airport_code || (flight ? flight.origin_airport : '--');
            var dest = b.destination_airport_code || (flight ? flight.destination_airport : '--');

            return '<tr>' +
                '<td><strong>' + flightNum + '</strong></td>' +
                '<td>' + origin + ' \u2192 ' + dest + '</td>' +
                '<td>' + (b.aircraft_type || '--') + '</td>' +
                '<td>' + (b.tail_number || '--') + '</td>' +
                '<td>' + (b.burn_date || '--') + '</td>' +
                '<td class="num-cell">' + fmt(b.planned_burn_kg) + '</td>' +
                '<td class="num-cell"><strong>' + fmt(b.actual_burn_kg) + '</strong></td>' +
                '<td class="num-cell">' + fmt(b.variance_kg) + '</td>' +
                '<td class="num-cell">' + varianceBadge(b.variance_pct) + '</td>' +
                '<td>' + statusBadge(b.data_source) + '</td>' +
                '<td>' + statusBadge(b.status) + '</td>' +
                '</tr>';
        }).join('');
    }

    // ═══ ROB Fleet Dashboard ═══
    function renderROBDashboard(robLedger) {
        var tbody = document.getElementById('robBody');
        if (!tbody) return;
        if (robLedger.length === 0) {
            tbody.innerHTML = '<tr><td colspan="11" class="loading">No ROB records found</td></tr>';
            return;
        }

        // Get latest entry per tail number
        var latestByTail = {};
        robLedger.forEach(function(r) {
            var key = r.tail_number;
            if (!latestByTail[key] || r.record_date > latestByTail[key].record_date ||
                (r.record_date === latestByTail[key].record_date && r.sequence > latestByTail[key].sequence)) {
                latestByTail[key] = r;
            }
        });

        // Also show full ledger for detail
        tbody.innerHTML = robLedger.map(function(r) {
            var robPct = r.rob_percentage || (r.max_capacity_kg ? (r.closing_rob_kg / r.max_capacity_kg * 100) : null);
            var robStatus = robPct >= 50 ? 'OK' : robPct >= 25 ? 'LOW' : 'CRITICAL';

            return '<tr>' +
                '<td><strong>' + (r.tail_number || '--') + '</strong></td>' +
                '<td>' + (r.aircraft_type || '--') + '</td>' +
                '<td>' + (r.airport_code || '--') + '</td>' +
                '<td>' + statusBadge(r.entry_type) + '</td>' +
                '<td class="num-cell">' + fmt(r.opening_rob_kg) + '</td>' +
                '<td class="num-cell">' + (r.uplift_kg > 0 ? '<span class="text-green">+' + fmt(r.uplift_kg) + '</span>' : fmt(r.uplift_kg)) + '</td>' +
                '<td class="num-cell">' + (r.burn_kg > 0 ? '<span class="text-red">-' + fmt(r.burn_kg) + '</span>' : fmt(r.burn_kg)) + '</td>' +
                '<td class="num-cell"><strong>' + fmt(r.closing_rob_kg) + '</strong></td>' +
                '<td class="num-cell">' + fmt(r.max_capacity_kg) + '</td>' +
                '<td>' + (robPct != null ? robBar(robPct) : '--') + '</td>' +
                '<td>' + statusBadge(robStatus) + '</td>' +
                '</tr>';
        }).join('');
    }

    // ═══ Delivery Tracker ═══
    function renderDeliveryTracker(deliveries, orders, flights, tickets) {
        var tbody = document.getElementById('deliveryBody');
        if (!tbody) return;
        if (deliveries.length === 0) {
            tbody.innerHTML = '<tr><td colspan="11" class="loading">No deliveries found</td></tr>';
            return;
        }
        tbody.innerHTML = deliveries.map(function(d) {
            var order = orders.find(function(o) { return o.ID === d.order_ID; });
            var orderNum = order ? order.order_number : '--';
            var flight = order ? flights.find(function(f) { return f.ID === order.flight_ID; }) : null;
            var flightNum = flight ? flight.flight_number : '--';
            var station = order ? order.station_code : '--';
            var ticket = tickets.find(function(t) { return t.delivery_ID === d.ID; });

            var signedCell = d.signature_timestamp ?
                '<span class="badge badge-confirmed">SIGNED</span>' :
                '<span class="badge badge-pending">PENDING</span>';
            var ticketCell = ticket ?
                '<span class="badge badge-completed">' + ticket.ticket_number + '</span>' :
                '<span class="text-muted">--</span>';
            var grCell = d.s4_gr_number ?
                '<span class="badge badge-confirmed">' + d.s4_gr_number + '</span>' :
                '<span class="text-muted">Pending</span>';

            return '<tr>' +
                '<td><strong>' + (d.delivery_number || d.epod_number || '--') + '</strong></td>' +
                '<td>' + fuelOrderLink(orderNum) + '</td>' +
                '<td>' + flightNum + '</td>' +
                '<td>' + station + '</td>' +
                '<td class="num-cell">' + fmt(d.delivered_quantity) + '</td>' +
                '<td>' + (d.density || '--') + '</td>' +
                '<td>' + (d.temperature || '--') + '</td>' +
                '<td>' + (d.vehicle_id || '--') + '</td>' +
                '<td>' + signedCell + '</td>' +
                '<td>' + ticketCell + '</td>' +
                '<td>' + grCell + '</td>' +
                '</tr>';
        }).join('');
    }

    // ═══ Finance Summary ═══
    function renderFinanceSummary(orders, flights) {
        // KPIs
        var totalValue = 0, deliveredValue = 0, postedCount = 0, pendingCount = 0;
        orders.forEach(function(o) {
            totalValue += (o.total_amount || 0);
            if (o.status === 'Delivered' || o.status === 'Completed') {
                deliveredValue += (o.total_amount || 0);
            }
            if (o.s4_po_number) postedCount++;
            else if (o.status !== 'Draft' && o.status !== 'Cancelled') pendingCount++;
        });

        setText('finTotalValue', fmtCurrency(totalValue));
        setText('finDeliveredValue', fmtCurrency(deliveredValue));
        setText('finPostedCount', postedCount);
        setText('finPendingCount', pendingCount);

        var tbody = document.getElementById('financeBody');
        if (!tbody) return;

        // Show only non-draft orders for finance
        var finOrders = orders.filter(function(o) { return o.status !== 'Draft'; });
        if (finOrders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" class="loading">No finance records</td></tr>';
            return;
        }
        tbody.innerHTML = finOrders.map(function(o) {
            var flight = flights.find(function(f) { return f.ID === o.flight_ID; });
            var flightNum = flight ? flight.flight_number : '--';
            var poCell = o.s4_po_number ?
                '<span class="badge badge-confirmed">' + o.s4_po_number + '</span>' :
                '<span class="text-muted">--</span>';
            var postingCell = o.s4_po_number ?
                '<span class="badge badge-completed">POSTED</span>' :
                '<span class="badge badge-pending">PENDING</span>';

            return '<tr>' +
                '<td>' + fuelOrderLink(o.order_number) + '</td>' +
                '<td>' + flightNum + '</td>' +
                '<td>' + (o.station_code || '--') + '</td>' +
                '<td class="num-cell">' + fmt(o.ordered_quantity) + '</td>' +
                '<td class="num-cell">' + fmtDec(o.unit_price, 4) + '</td>' +
                '<td class="num-cell"><strong>' + fmtCurrency(o.total_amount, o.currency_code) + '</strong></td>' +
                '<td>' + (o.currency_code || '--') + '</td>' +
                '<td>' + poCell + '</td>' +
                '<td>' + statusBadge(o.status) + '</td>' +
                '<td>' + postingCell + '</td>' +
                '</tr>';
        }).join('');
    }

    // ═══ Persona Visibility ═══
    function initPersona() {
        var selector = document.getElementById('personaSelector');
        if (!selector) return;
        selector.addEventListener('change', function() {
            currentPersona = selector.value;
            loadDashboard();
        });
    }

    function applyPersona(persona) {
        var journeySection = document.getElementById('journeySection');
        var kpiSection = document.getElementById('kpiSection');
        var ordersSection = document.getElementById('ordersSection');
        var burnSection = document.getElementById('burnSection');
        var robSection = document.getElementById('robSection');
        var deliverySection = document.getElementById('deliverySection');
        var financeSection = document.getElementById('financeSection');

        var allSections = [journeySection, kpiSection, ordersSection, burnSection, robSection, deliverySection, financeSection];
        allSections.forEach(function(el) { if (el) el.style.display = ''; });

        if (persona === 'ops') {
            // Ops Manager: everything except finance
            if (financeSection) financeSection.style.display = 'none';
        } else if (persona === 'dispatch') {
            // Dispatch Team: journey, KPIs, orders, deliveries
            if (burnSection) burnSection.style.display = 'none';
            if (robSection) robSection.style.display = 'none';
            if (financeSection) financeSection.style.display = 'none';
        } else if (persona === 'planning') {
            // Fuel Planning Manager: journey, KPIs, orders, burn analysis
            if (robSection) robSection.style.display = 'none';
            if (deliverySection) deliverySection.style.display = 'none';
            if (financeSection) financeSection.style.display = 'none';
        } else if (persona === 'finance') {
            // Finance Controller: journey, KPIs, orders, finance
            if (burnSection) burnSection.style.display = 'none';
            if (robSection) robSection.style.display = 'none';
            if (deliverySection) deliverySection.style.display = 'none';
        }
    }

    function init() {
        loadDashboard();
        initPersona();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
