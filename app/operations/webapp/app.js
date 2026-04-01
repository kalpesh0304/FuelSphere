/* FuelSphere Operations Dashboard — app.js */
(function () {
    'use strict';

    var ORDER_SVC = '/odata/v4/orders';
    var BURN_SVC = '/odata/v4/burn';

    function fmt(n) { return n == null ? '--' : Number(n).toLocaleString(); }

    function statusBadge(status) {
        if (!status) return '';
        var cls = {
            Draft: 'badge-draft', Submitted: 'badge-submitted',
            Confirmed: 'badge-confirmed', InProgress: 'badge-inprogress',
            Delivered: 'badge-delivered', Completed: 'badge-completed',
            Cancelled: 'badge-cancelled', SCHEDULED: 'badge-scheduled',
            ARRIVED: 'badge-arrived', DEPARTED: 'badge-departed'
        };
        return '<span class="badge ' + (cls[status] || 'badge-draft') + '">' + status + '</span>';
    }

    function crewBadge(status) {
        if (!status) return '<span class="badge badge-pending">Pending</span>';
        var cls = { PENDING: 'badge-pending', CONFIRMED: 'badge-confirmed', ADJUSTED: 'badge-adjusted', SKIPPED: 'badge-draft' };
        return '<span class="badge ' + (cls[status] || 'badge-draft') + '">' + status + '</span>';
    }

    function journeyStep(order) {
        if (!order) return 1;
        if (order.status === 'Delivered' || order.status === 'Completed') {
            if (order.s4_po_number) return 7;
            return 6;
        }
        if (order.status === 'InProgress') return 5;
        if (order.crew_review_status === 'CONFIRMED' || order.crew_review_status === 'ADJUSTED') return 4;
        if (order.status === 'Confirmed') return 3;
        if (order.status === 'Submitted' || order.status === 'Draft') return 2;
        return 1;
    }

    function dMinusDay(flightDate) {
        if (!flightDate) return null;
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        var fDate = new Date(flightDate + 'T00:00:00');
        var diff = Math.round((fDate - today) / (1000 * 60 * 60 * 24));
        if (diff >= 3) return 'D-3';
        if (diff === 2) return 'D-2';
        if (diff === 1) return 'D-1';
        return 'D-0';
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

    // Main dashboard load
    async function loadDashboard() {
        var [orders, flights, burns, robLedger] = await Promise.all([
            odata(ORDER_SVC + '/FuelOrders?$orderby=requested_date desc'),
            odata(ORDER_SVC + '/FlightSchedule?$orderby=flight_date desc,scheduled_departure asc'),
            odata(BURN_SVC + '/FuelBurns?$top=500'),
            odata(BURN_SVC + '/ROBLedger?$top=500')
        ]);

        // Filter out PR flights
        function isPRFlight(f) {
            return f.airline_code === 'PR' || (f.flight_number && f.flight_number.substring(0, 2) === 'PR');
        }
        var filteredFlights = flights.filter(function(f) { return !isPRFlight(f); });
        var allOrders = orders.filter(function(o) {
            var flight = flights.find(function(f) { return f.ID === o.flight_ID; });
            if (!flight) return true;
            return !isPRFlight(flight);
        });

        // D-Minus counts
        var dCounts = { 'D-3': 0, 'D-2': 0, 'D-1': 0, 'D-0': 0 };
        filteredFlights.forEach(function(f) {
            var d = dMinusDay(f.flight_date);
            if (d && dCounts.hasOwnProperty(d)) dCounts[d]++;
        });
        setText('dMinus3Count', dCounts['D-3']);
        setText('dMinus2Count', dCounts['D-2']);
        setText('dMinus1Count', dCounts['D-1']);
        setText('dMinus0Count', dCounts['D-0']);

        // Journey timeline counts
        var flightsWithOrders = new Set(allOrders.filter(function(o) { return o.flight_ID; }).map(function(o) { return o.flight_ID; }));
        setText('step1Count', filteredFlights.filter(function(f) { return !flightsWithOrders.has(f.ID); }).length);
        setText('step2Count', allOrders.filter(function(o) { return o.status === 'Draft' || o.status === 'Submitted'; }).length);
        setText('step3Count', allOrders.filter(function(o) { return o.status === 'Confirmed' && !o.crew_review_status; }).length);
        setText('step4Count', allOrders.filter(function(o) { return (o.crew_review_status === 'CONFIRMED' || o.crew_review_status === 'ADJUSTED') && o.status === 'Confirmed'; }).length);
        setText('step5Count', allOrders.filter(function(o) { return o.status === 'InProgress'; }).length);
        setText('step6Count', allOrders.filter(function(o) { return o.status === 'Delivered'; }).length);
        setText('step7Count', allOrders.filter(function(o) { return o.status === 'Completed'; }).length);

        // KPIs
        setText('kpiActiveOrders', allOrders.filter(function(o) { return o.status !== 'Cancelled' && o.status !== 'Completed'; }).length);
        setText('kpiCrewPending', allOrders.filter(function(o) { return o.status === 'Confirmed' && (!o.crew_review_status || o.crew_review_status === 'PENDING'); }).length);
        setText('kpiDeliveries', allOrders.filter(function(o) { return o.status === 'InProgress'; }).length);
        setText('kpiCompleted', allOrders.filter(function(o) { return o.status === 'Delivered' || o.status === 'Completed'; }).length);

        // Burn analysis
        var totalBurn = 0, burnCount = 0;
        burns.forEach(function(b) { totalBurn += Number(b.actual_burn_kg) || 0; burnCount++; });
        var totalUplift = 0;
        robLedger.forEach(function(r) { totalUplift += Number(r.uplift_kg) || 0; });
        setText('burnTotal', fmt(Math.round(totalBurn)));
        setText('burnAvg', burnCount > 0 ? fmt(Math.round(totalBurn / burnCount)) : '0');
        setText('burnUplift', fmt(Math.round(totalUplift)));
        setText('burnVariance', burns.filter(function(b) { return b.variance_percentage && Math.abs(b.variance_percentage) > 2; }).length);

        // Flights table
        var flightsBody = document.getElementById('flightsBody');
        if (flightsBody) {
            if (filteredFlights.length === 0) {
                flightsBody.innerHTML = '<tr><td colspan="10" class="loading">No flights found</td></tr>';
            } else {
                flightsBody.innerHTML = filteredFlights.map(function(f) {
                    var hasOrder = flightsWithOrders.has(f.ID);
                    var terminal = (f.departure_terminal || '--') + ' / ' + (f.arrival_terminal || '--');
                    if (!f.departure_terminal && !f.arrival_terminal) terminal = '--';
                    var dDay = dMinusDay(f.flight_date);
                    return '<tr>' +
                        '<td><strong>' + f.flight_number + '</strong></td>' +
                        '<td>' + f.flight_date + '</td>' +
                        '<td>' + (f.origin_airport || '--') + ' \u2192 ' + (f.destination_airport || '--') + '</td>' +
                        '<td>' + (f.aircraft_type || '--') + '</td>' +
                        '<td>' + (f.aircraft_reg || '--') + '</td>' +
                        '<td>' + terminal + '</td>' +
                        '<td>' + (f.gate_number || '--') + '</td>' +
                        '<td>' + statusBadge(f.status) + '</td>' +
                        '<td><span class="badge badge-dminus">' + (dDay || '--') + '</span></td>' +
                        '<td>' + (hasOrder ? '<span class="badge badge-confirmed">Yes</span>' : '<span class="badge badge-draft">No</span>') + '</td>' +
                        '</tr>';
                }).join('');
            }
        }

        // Orders table
        var ordersBody = document.getElementById('ordersBody');
        if (ordersBody) {
            if (allOrders.length === 0) {
                ordersBody.innerHTML = '<tr><td colspan="8" class="loading">No fuel orders found</td></tr>';
            } else {
                ordersBody.innerHTML = allOrders.map(function(o) {
                    var flight = flights.find(function(f) { return f.ID === o.flight_ID; });
                    var route = flight ? (flight.origin_airport + ' \u2192 ' + flight.destination_airport) : '--';
                    var flightNum = flight ? flight.flight_number : '--';
                    var step = journeyStep(o);
                    return '<tr>' +
                        '<td><strong>' + (o.order_number || '--') + '</strong></td>' +
                        '<td>' + flightNum + '</td>' +
                        '<td>' + route + '</td>' +
                        '<td>' + (o.requested_date || '--') + '</td>' +
                        '<td>' + fmt(o.ordered_quantity) + '</td>' +
                        '<td>' + statusBadge(o.status) + '</td>' +
                        '<td>' + crewBadge(o.crew_review_status) + '</td>' +
                        '<td><span class="badge badge-step">Step ' + step + '</span></td>' +
                        '</tr>';
                }).join('');
            }
        }
    }

    loadDashboard();
})();
