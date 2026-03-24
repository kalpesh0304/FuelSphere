/* FuelSphere Airline Dashboard — app.js */
(function () {
    'use strict';

    // OData base paths
    const ORDER_SVC = '/odata/v4/orders';
    const BURN_SVC = '/odata/v4/burn';

    // ========================================================================
    // HELPERS
    // ========================================================================

    function fmt(n) { return n == null ? '—' : Number(n).toLocaleString(); }

    function statusBadge(status) {
        if (!status) return '';
        const cls = {
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
        const cls = {
            PENDING: 'badge-pending', CONFIRMED: 'badge-confirmed',
            ADJUSTED: 'badge-adjusted', SKIPPED: 'badge-draft'
        };
        return '<span class="badge ' + (cls[status] || 'badge-draft') + '">' + status + '</span>';
    }

    function journeyStep(order) {
        if (!order) return 1;
        if (order.status === 'Delivered' || order.status === 'Completed') {
            if (order.s4_po_number) return 7; // has S4 PO → step 6 or 7
            return 6;
        }
        if (order.status === 'InProgress') return 5;
        if (order.crew_review_status === 'CONFIRMED' || order.crew_review_status === 'ADJUSTED') return 4;
        if (order.status === 'Confirmed') return 3;
        if (order.status === 'Submitted' || order.status === 'Draft') return 2;
        return 1;
    }

    function stepBadge(step) {
        return '<span class="badge badge-step">Step ' + step + '</span>';
    }

    async function odata(url) {
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(res.statusText);
            const json = await res.json();
            return json.value || json;
        } catch (e) {
            console.error('OData error:', url, e);
            return [];
        }
    }

    // ========================================================================
    // DATETIME
    // ========================================================================

    function updateDateTime() {
        const el = document.getElementById('datetime');
        if (el) el.textContent = new Date().toLocaleString('en-CA', {
            weekday: 'short', year: 'numeric', month: 'short',
            day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    }
    updateDateTime();
    setInterval(updateDateTime, 60000);

    // ========================================================================
    // LOAD DATA
    // ========================================================================

    async function loadDashboard() {
        // Fetch orders and flights in parallel
        const [orders, flights, invoices] = await Promise.all([
            odata(ORDER_SVC + '/FuelOrders?$orderby=requested_date desc'),
            odata(ORDER_SVC + '/FlightSchedule?$filter=airline_code eq \'AC\'&$orderby=flight_date desc,scheduled_departure asc'),
            odata('/odata/v4/invoice/Invoices?$filter=status eq \'POSTED\'&$top=100')
        ]);

        // Filter AC orders (station codes YYZ, YVR, LHR, CDG, NRT, FLL, YUL or order number contains AC pattern)
        const acStations = new Set(['YYZ', 'YVR', 'LHR', 'CDG', 'NRT', 'FLL', 'YUL']);
        const acFlightIds = new Set(flights.map(f => f.ID));
        const acOrders = orders.filter(o => acFlightIds.has(o.flight_ID) || (o.order_number && o.order_number.match(/FO-(YYZ|YVR|LHR|CDG|NRT|FLL|YUL)-/)));

        // ====================================================================
        // JOURNEY TIMELINE COUNTS
        // ====================================================================

        // Step 1: Flights without orders
        const flightsWithOrders = new Set(orders.filter(o => o.flight_ID).map(o => o.flight_ID));
        const step1 = flights.filter(f => !flightsWithOrders.has(f.ID)).length;

        // Step 2: Flights with tail (enriched) that have draft/submitted orders
        const step2 = acOrders.filter(o => o.status === 'Draft' || o.status === 'Submitted').length;

        // Step 3: Confirmed orders (dispatch complete, no crew review yet)
        const step3 = acOrders.filter(o => o.status === 'Confirmed' && !o.crew_review_status).length;

        // Step 4: Crew reviewed
        const step4 = acOrders.filter(o => (o.crew_review_status === 'CONFIRMED' || o.crew_review_status === 'ADJUSTED') && o.status === 'Confirmed').length;

        // Step 5: InProgress (refueling)
        const step5 = acOrders.filter(o => o.status === 'InProgress').length;

        // Step 6: Delivered with S4 PO (ticket signed)
        const step6 = acOrders.filter(o => o.status === 'Delivered' && o.s4_po_number && !invoices.some(inv => inv.fuel_order_ID === o.ID && inv.status === 'POSTED')).length;

        // Step 7: Invoice settled
        const step7 = acOrders.filter(o => o.status === 'Delivered' && invoices.some(inv => inv.fuel_order_ID === o.ID && inv.status === 'POSTED')).length;

        setText('step1Count', step1);
        setText('step2Count', step2);
        setText('step3Count', step3);
        setText('step4Count', step4);
        setText('step5Count', step5);
        setText('step6Count', step6);
        setText('step7Count', step7);

        // ====================================================================
        // KPI CARDS
        // ====================================================================

        const activeOrders = acOrders.filter(o => o.status !== 'Cancelled' && o.status !== 'Completed').length;
        const crewPending = acOrders.filter(o => o.status === 'Confirmed' && (!o.crew_review_status || o.crew_review_status === 'PENDING')).length;
        const deliveriesInProgress = acOrders.filter(o => o.status === 'InProgress').length;
        const deliveredCompleted = acOrders.filter(o => o.status === 'Delivered' || o.status === 'Completed').length;

        setText('kpiActiveOrders', activeOrders);
        setText('kpiCrewPending', crewPending);
        setText('kpiDeliveries', deliveriesInProgress);
        setText('kpiCompleted', deliveredCompleted);

        // ====================================================================
        // ORDERS TABLE
        // ====================================================================

        const ordersBody = document.getElementById('ordersBody');
        if (ordersBody) {
            if (acOrders.length === 0) {
                ordersBody.innerHTML = '<tr><td colspan="8" class="loading">No Air Canada orders found</td></tr>';
            } else {
                ordersBody.innerHTML = acOrders.map(o => {
                    const flight = flights.find(f => f.ID === o.flight_ID);
                    const route = flight ? (flight.origin_airport + ' → ' + flight.destination_airport) : '—';
                    const flightNum = flight ? flight.flight_number : '—';
                    const step = journeyStep(o);
                    return '<tr>' +
                        '<td><strong>' + (o.order_number || '—') + '</strong></td>' +
                        '<td>' + flightNum + '</td>' +
                        '<td>' + route + '</td>' +
                        '<td>' + (o.requested_date || '—') + '</td>' +
                        '<td>' + fmt(o.ordered_quantity) + '</td>' +
                        '<td>' + statusBadge(o.status) + '</td>' +
                        '<td>' + crewBadge(o.crew_review_status) + '</td>' +
                        '<td>' + stepBadge(step) + '</td>' +
                        '</tr>';
                }).join('');
            }
        }

        // ====================================================================
        // FLIGHTS TABLE
        // ====================================================================

        const flightsBody = document.getElementById('flightsBody');
        if (flightsBody) {
            if (flights.length === 0) {
                flightsBody.innerHTML = '<tr><td colspan="7" class="loading">No Air Canada flights found</td></tr>';
            } else {
                flightsBody.innerHTML = flights.map(f => {
                    const hasOrder = flightsWithOrders.has(f.ID);
                    return '<tr>' +
                        '<td><strong>' + f.flight_number + '</strong></td>' +
                        '<td>' + f.flight_date + '</td>' +
                        '<td>' + f.origin_airport + ' → ' + f.destination_airport + '</td>' +
                        '<td>' + (f.aircraft_type || '—') + '</td>' +
                        '<td>' + (f.aircraft_reg || '—') + '</td>' +
                        '<td>' + statusBadge(f.status) + '</td>' +
                        '<td>' + (hasOrder
                            ? '<span class="badge badge-confirmed">Yes</span>'
                            : '<span class="badge badge-draft">No</span>') + '</td>' +
                        '</tr>';
                }).join('');
            }
        }
    }

    function setText(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val != null ? val : '—';
    }

    // Load on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadDashboard);
    } else {
        loadDashboard();
    }
})();
