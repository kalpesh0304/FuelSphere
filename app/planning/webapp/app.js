/* FuelSphere Planning App — app.js */
(function () {
    'use strict';

    var ORDER_SVC = '/odata/v4/orders';
    var PLANNING_SVC = '/odata/v4/planning';
    var MASTER_SVC = '/odata/v4/master';
    var FUEL_ORDER_APP = 'https://glcmjmynl0mfp4nx.launchpad.cfapps.eu10.hana.ondemand.com/91d3cd79-fbcd-42e1-bb4b-591d8070935e.comfuelspherefuelorders.comfuelspherefuelorders-0.0.1/index.html';
    var currentPersona = 'all';

    // Cached datasets for filtering and drill-down
    var _flights = [];
    var _orders = [];
    var _dispatches = [];
    var _suppliers = [];
    var _filters = { airport: '', airline: '', supplier: '', timeWindow: '', search: '' };

    function sectorIATA(origin, destination) {
        if (!origin && !destination) return '--';
        return (origin || '???') + '-' + (destination || '???');
    }

    function fmtTime(t) {
        if (!t) return '--';
        // Time format from OData is HH:MM:SS — show HH:MM
        return String(t).substring(0, 5);
    }

    function fmtBlockMins(mins) {
        if (!mins) return '--';
        var h = Math.floor(mins / 60);
        var m = mins % 60;
        return h + 'h ' + (m < 10 ? '0' : '') + m + 'm';
    }

    function fuelOrderLink(orderNum) {
        if (!orderNum) return '--';
        return '<a href="' + FUEL_ORDER_APP + '" target="_blank" class="fo-link" title="Open in Fuel Orders app">' + orderNum + '</a>';
    }

    function fmt(n) { return n == null ? '--' : Number(n).toLocaleString(); }

    function statusBadge(status) {
        if (!status) return '';
        var cls = {
            Draft: 'badge-draft', Submitted: 'badge-submitted',
            Confirmed: 'badge-confirmed', InProgress: 'badge-inprogress',
            Delivered: 'badge-delivered', Completed: 'badge-completed',
            Cancelled: 'badge-cancelled', SCHEDULED: 'badge-scheduled',
            ARRIVED: 'badge-arrived', DEPARTED: 'badge-departed',
            PENDING: 'badge-pending', ADJUSTED: 'badge-adjusted',
            DRAFT: 'badge-draft', AWAITING_REVIEW: 'badge-pending'
        };
        return '<span class="badge ' + (cls[status] || 'badge-draft') + '">' + status + '</span>';
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

    // Determine the correct crew status label for display
    function getCrewStatusLabel(order) {
        if (!order) return 'DRAFT';
        // Draft orders haven't been submitted yet — show DRAFT, not PENDING
        if (order.status === 'Draft') return 'DRAFT';
        // Confirmed orders without crew review → awaiting crew review
        if (order.status === 'Confirmed' && (!order.crew_review_status || order.crew_review_status === 'PENDING')) return 'AWAITING_REVIEW';
        // Crew has reviewed
        if (order.crew_review_status === 'ADJUSTED') return 'ADJUSTED';
        if (order.crew_review_status === 'CONFIRMED') return 'CONFIRMED';
        // InProgress / Delivered / Completed — already past crew review
        if (['InProgress', 'Delivered', 'Completed'].indexOf(order.status) >= 0) return 'CONFIRMED';
        return order.crew_review_status || 'DRAFT';
    }

    async function loadDashboard() {
        var [orders, flights, dispatches, suppliers] = await Promise.all([
            odata(ORDER_SVC + '/FuelOrders?$orderby=requested_date desc'),
            odata(ORDER_SVC + '/FlightSchedule?$orderby=flight_date desc,scheduled_departure asc'),
            odata(ORDER_SVC + '/FlightDispatches?$top=500'),
            odata(MASTER_SVC + '/Suppliers?$top=200')
        ]);

        // Cache for filters / drill-down
        _flights = flights;
        _orders = orders;
        _dispatches = dispatches;
        _suppliers = suppliers;

        var baseFlights = flights.filter(function(f) { return !isPRFlight(f); });

        // Populate filter dropdowns once (use unfiltered set so options stay stable)
        populateFilterDropdowns(baseFlights, orders, suppliers);

        // Apply global filters to flights AND derive filtered orders
        var filteredFlights = applyFlightFilters(baseFlights);
        var filteredFlightIDs = new Set(filteredFlights.map(function(f) { return f.ID; }));
        var allOrders = orders.filter(function(o) {
            var flight = flights.find(function(f) { return f.ID === o.flight_ID; });
            if (flight && isPRFlight(flight)) return false;
            // If a flight filter set is active, only keep orders linked to those flights
            if (hasActiveFilters() && o.flight_ID && !filteredFlightIDs.has(o.flight_ID)) return false;
            // Supplier filter without flight context
            if (_filters.supplier && o.supplier_ID !== _filters.supplier) return false;
            return true;
        });

        // KPIs
        var flightsWithOrders = new Set(allOrders.filter(function(o) { return o.flight_ID; }).map(function(o) { return o.flight_ID; }));
        // Build flight → order number lookup
        var flightOrderMap = {};
        allOrders.forEach(function(o) {
            if (o.flight_ID && o.order_number) flightOrderMap[o.flight_ID] = o.order_number;
        });

        // "Flights Needing Fuel Plan" = SCHEDULED flights (filtered) that have NO fuel order yet
        var scheduledNoOrder = filteredFlights.filter(function(f) {
            return !flightsWithOrders.has(f.ID) && f.status === 'SCHEDULED';
        });
        setText('kpiFlightsToday', scheduledNoOrder.length);
        // Show which flights in tooltip
        var noOrderNames = scheduledNoOrder.map(function(f) { return f.flight_number; }).join(', ');
        var kpiEl = document.getElementById('kpiFlightsToday');
        if (kpiEl) kpiEl.title = noOrderNames || 'None';

        // "Pending Crew Review" = Confirmed orders where crew hasn't reviewed yet
        var pendingReview = allOrders.filter(function(o) {
            return o.status === 'Confirmed' && (!o.crew_review_status || o.crew_review_status === 'PENDING');
        });
        setText('kpiPendingReview', pendingReview.length);

        var pilotOverrides = allOrders.filter(function(o) { return o.crew_review_status === 'ADJUSTED'; }).length;
        var confirmed = allOrders.filter(function(o) {
            return o.crew_review_status === 'CONFIRMED' ||
                   ['InProgress', 'Delivered', 'Completed'].indexOf(o.status) >= 0;
        }).length;

        setText('kpiOverrides', pilotOverrides);
        setText('kpiConfirmed', confirmed);

        // 3-Figure comparison
        var compBody = document.getElementById('comparisonBody');
        if (compBody) {
            if (allOrders.length === 0) {
                compBody.innerHTML = '<div class="comparison-loading">No fuel orders found for comparison.</div>';
            } else {
                var html = '';
                allOrders.forEach(function(o) {
                    var flight = flights.find(function(f) { return f.ID === o.flight_ID; });
                    var flightNum = flight ? flight.flight_number : '--';
                    var route = flight ? (flight.origin_airport + ' \u2192 ' + flight.destination_airport) : '';
                    var dispatch = dispatches.find(function(d) { return d.fuel_order_ID === o.ID; });

                    var dispatchQty = dispatch ? (dispatch.dispatch_qty_kg || o.ordered_quantity) : o.ordered_quantity;
                    var plannerQty = o.ordered_quantity || 0;
                    var cockpitQty = o.crew_review_status === 'ADJUSTED' ? (o.crew_adjusted_quantity || plannerQty) : plannerQty;
                    var robKg = dispatch ? (dispatch.rob_departure_kg || 0) : 0;
                    // Net Uplift = Cockpit Confirmed Qty - ROB (this is the only figure sent to supplier)
                    var netUplift = Math.max(0, cockpitQty - robKg);

                    var crewStatus = getCrewStatusLabel(o);
                    var isAdjusted = o.crew_review_status === 'ADJUSTED';
                    var isAwaitingReview = crewStatus === 'AWAITING_REVIEW';

                    // Cockpit crew action buttons (only for AWAITING_REVIEW orders)
                    var cockpitActions = '';
                    if (currentPersona === 'cockpit' && isAwaitingReview) {
                        cockpitActions = '<div class="cockpit-actions">' +
                            '<button class="btn-confirm" data-order-id="' + o.ID + '" data-flight="' + flightNum + '" data-qty="' + plannerQty + '">Confirm</button>' +
                            '<button class="btn-adjust" data-order-id="' + o.ID + '" data-flight="' + flightNum + '" data-qty="' + plannerQty + '">Adjust</button>' +
                            '</div>';
                    }

                    html += '<div class="comparison-row' + (isAdjusted ? ' comparison-row-adjusted' : '') + (isAwaitingReview && currentPersona === 'cockpit' ? ' comparison-row-review' : '') + '">' +
                        '<div class="flight-info"><span class="flight-number">' + flightNum + '</span><span class="flight-route"><span class="sector-iata">' + (route || '').replace(' \u2192 ', '-') + '</span></span></div>' +
                        '<div class="qty-cell qty-dispatch">' + fmt(Math.round(dispatchQty)) + '</div>' +
                        '<div class="qty-cell qty-planner">' + fmt(Math.round(plannerQty)) + '</div>' +
                        '<div class="qty-cell qty-cockpit">' + fmt(Math.round(cockpitQty)) + '</div>' +
                        '<div class="qty-cell qty-rob">' + fmt(Math.round(robKg)) + '</div>' +
                        '<div class="qty-cell qty-uplift" title="Net Uplift = Cockpit - ROB. This is the figure sent to the supplier.">' + fmt(Math.round(netUplift)) + '</div>' +
                        '<div>' + statusBadge(crewStatus) + cockpitActions + '</div>' +
                        '</div>';

                    // Inline override reason row
                    if (isAdjusted) {
                        var diff = (o.crew_adjusted_quantity || 0) - (o.ordered_quantity || 0);
                        var diffStr = diff >= 0 ? '+' + fmt(diff) : fmt(diff);
                        var reason = o.crew_adjustment_reason || '';
                        var notes = o.crew_notes || '';
                        var captain = o.crew_reviewed_by || '';
                        html += '<div class="override-inline">' +
                            '<div class="override-inline-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" fill="#E9730C"/></svg></div>' +
                            '<div class="override-inline-detail">' +
                            '<span class="override-inline-diff">' + diffStr + ' kg</span>' +
                            '<span class="override-inline-reason">' + (reason || 'No reason provided') + '</span>' +
                            (notes ? '<span class="override-inline-notes">' + notes + '</span>' : '') +
                            (captain ? '<span class="override-inline-captain">By: ' + captain + '</span>' : '') +
                            '</div></div>';
                    }
                });
                compBody.innerHTML = html;
            }
        }

        // Flights table — only SCHEDULED (filters already applied at top of loadDashboard)
        var scheduledFlights = filteredFlights.filter(function(f) { return f.status === 'SCHEDULED'; });
        renderFlightsTable(scheduledFlights, flightOrderMap, flightsWithOrders);
        updateFilterChips();

        // Apply persona visibility after data loads
        applyPersona(currentPersona);
    }

    // ═══ Flight Table Rendering (filters already applied upstream) ═══
    function renderFlightsTable(scheduledFlights, flightOrderMap, flightsWithOrders) {
        var flightsBody = document.getElementById('flightsBody');
        if (!flightsBody) return;

        if (scheduledFlights.length === 0) {
            flightsBody.innerHTML = '<tr><td colspan="13" class="loading">' +
                (hasActiveFilters() ? 'No flights match the current filters' : 'No scheduled flights found') +
                '</td></tr>';
            return;
        }

        var showEnrich = (currentPersona === 'all' || currentPersona === 'planner');
        flightsBody.innerHTML = scheduledFlights.map(function(f) {
            var hasOrder = flightsWithOrders.has(f.ID);
            var needsEnrich = !f.aircraft_type || !f.aircraft_reg;
            var aircraftCell = f.aircraft_type ?
                f.aircraft_type :
                '<span class="badge badge-draft">Not Set</span>';
            var regCell = f.aircraft_reg ?
                f.aircraft_reg :
                '<span class="badge badge-draft">Not Set</span>';
            var bookedCell = f.booked_passengers != null ? Number(f.booked_passengers).toLocaleString() : '<span class="text-muted">--</span>';
            var boardedCell = f.boarded_passengers != null ?
                '<span class="text-success">' + Number(f.boarded_passengers).toLocaleString() + '</span>' :
                '<span class="text-muted" title="Available ~30 min before departure">--</span>';
            var cargoCell = f.cargo_kg != null ? Number(f.cargo_kg).toLocaleString() : '<span class="text-muted">--</span>';

            // Make flight number clickable for drill-down
            var flightCell = '<button class="flight-link" data-flight-id="' + f.ID + '" type="button">' + f.flight_number + '</button>';

            var actionCell = showEnrich ?
                '<button class="btn-enrich' + (needsEnrich ? ' btn-enrich-needed' : '') + '" data-flight-id="' + f.ID + '" ' +
                'data-flight-number="' + f.flight_number + '" ' +
                'data-flight-date="' + f.flight_date + '" ' +
                'data-aircraft-type="' + (f.aircraft_type || '') + '" ' +
                'data-aircraft-reg="' + (f.aircraft_reg || '') + '" ' +
                'data-dep-terminal="' + (f.departure_terminal || '') + '" ' +
                'data-arr-terminal="' + (f.arrival_terminal || '') + '" ' +
                'data-gate="' + (f.gate_number || '') + '" ' +
                'data-stand="' + (f.stand_number || '') + '"' +
                '>' + (needsEnrich ? 'Enrich Now' : 'Edit') + '</button>' :
                '<span class="text-muted">--</span>';

            return '<tr>' +
                '<td>' + flightCell + '</td>' +
                '<td>' + f.flight_date + '</td>' +
                '<td><span class="sector-iata">' + sectorIATA(f.origin_airport, f.destination_airport) + '</span></td>' +
                '<td>' + fmtTime(f.scheduled_departure) + '</td>' +
                '<td>' + fmtTime(f.scheduled_arrival) + '</td>' +
                '<td>' + aircraftCell + '</td>' +
                '<td>' + regCell + '</td>' +
                '<td class="num-cell">' + bookedCell + '</td>' +
                '<td class="num-cell">' + boardedCell + '</td>' +
                '<td class="num-cell">' + cargoCell + '</td>' +
                '<td>' + statusBadge(f.status) + '</td>' +
                '<td>' + (hasOrder ? fuelOrderLink(flightOrderMap[f.ID]) : '<span class="badge badge-pending">—</span>') + '</td>' +
                '<td>' + actionCell + '</td>' +
                '</tr>';
        }).join('');
    }

    function hasActiveFilters() {
        return !!(_filters.airport || _filters.airline || _filters.supplier || _filters.timeWindow || _filters.search);
    }

    function updateFilterChips() {
        // Show a small visual indicator on the filter bar when filters are active
        var bar = document.getElementById('globalFilterBar');
        if (!bar) return;
        if (hasActiveFilters()) bar.classList.add('filter-bar-active');
        else bar.classList.remove('filter-bar-active');
    }

    function applyFlightFilters(flights) {
        return flights.filter(function(f) {
            if (_filters.airport && f.origin_airport !== _filters.airport && f.destination_airport !== _filters.airport) return false;
            if (_filters.airline && f.airline_code !== _filters.airline) return false;
            if (_filters.search) {
                var s = _filters.search.toUpperCase();
                if (f.flight_number.toUpperCase().indexOf(s) === -1) return false;
            }
            if (_filters.supplier) {
                // Match supplier via the linked fuel order
                var order = _orders.find(function(o) { return o.flight_ID === f.ID; });
                if (!order || order.supplier_ID !== _filters.supplier) return false;
            }
            if (_filters.timeWindow) {
                var hours = parseInt(_filters.timeWindow);
                if (!isNaN(hours)) {
                    var now = new Date();
                    var depTime = parseFlightDateTime(f);
                    if (!depTime) return false;
                    var diffH = (depTime.getTime() - now.getTime()) / (1000 * 60 * 60);
                    if (diffH < 0 || diffH > hours) return false;
                }
            }
            return true;
        });
    }

    function parseFlightDateTime(f) {
        if (!f.flight_date) return null;
        var t = f.scheduled_departure || '00:00:00';
        try {
            return new Date(f.flight_date + 'T' + t + 'Z');
        } catch (e) { return null; }
    }

    function populateFilterDropdowns(flights, orders, suppliers) {
        // Airport: union of origins + destinations
        var airports = new Set();
        flights.forEach(function(f) {
            if (f.origin_airport) airports.add(f.origin_airport);
            if (f.destination_airport) airports.add(f.destination_airport);
        });
        // Airline
        var airlines = new Set();
        flights.forEach(function(f) { if (f.airline_code) airlines.add(f.airline_code); });

        fillSelect('filterAirport', Array.from(airports).sort(), 'All Airports');
        fillSelect('filterAirline', Array.from(airlines).sort(), 'All Airlines');

        // Suppliers — use ID as value, name as label
        var supSel = document.getElementById('filterSupplier');
        if (supSel && supSel.options.length <= 1) {
            (suppliers || []).forEach(function(s) {
                if (!s.is_active && s.is_active !== undefined) return;
                var opt = document.createElement('option');
                opt.value = s.ID;
                opt.textContent = s.supplier_name || s.supplier_code || s.ID;
                supSel.appendChild(opt);
            });
        }
    }

    function fillSelect(id, values, defaultLabel) {
        var el = document.getElementById(id);
        if (!el || el.options.length > 1) return; // already populated
        // Keep first "All ..." option
        values.forEach(function(v) {
            var opt = document.createElement('option');
            opt.value = v; opt.textContent = v;
            el.appendChild(opt);
        });
    }

    function initFilters() {
        var fieldMap = {
            filterAirport: 'airport',
            filterAirline: 'airline',
            filterSupplier: 'supplier',
            filterTimeWindow: 'timeWindow'
        };
        Object.keys(fieldMap).forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.addEventListener('change', function() {
                _filters[fieldMap[id]] = el.value;
                loadDashboard();
            });
        });
        var search = document.getElementById('filterFlightSearch');
        if (search) {
            var debounce;
            search.addEventListener('input', function() {
                clearTimeout(debounce);
                debounce = setTimeout(function() {
                    _filters.search = search.value.trim();
                    loadDashboard();
                }, 250);
            });
        }
        var resetBtn = document.getElementById('filterReset');
        if (resetBtn) resetBtn.addEventListener('click', function() {
            _filters = { airport: '', airline: '', supplier: '', timeWindow: '', search: '' };
            ['filterAirport', 'filterAirline', 'filterSupplier', 'filterTimeWindow'].forEach(function(id) {
                var el = document.getElementById(id); if (el) el.value = '';
            });
            var s = document.getElementById('filterFlightSearch'); if (s) s.value = '';
            loadDashboard();
        });
    }

    // ═══ Flight Detail Drill-Down ═══
    function initFlightDetail() {
        var modal = document.getElementById('flightDetailModal');
        if (!modal) return;
        var closeBtn = document.getElementById('flightDetailClose');
        var closeBtn2 = document.getElementById('flightDetailCloseBtn');
        function close() { modal.style.display = 'none'; }
        if (closeBtn) closeBtn.addEventListener('click', close);
        if (closeBtn2) closeBtn2.addEventListener('click', close);
        modal.addEventListener('click', function(e) { if (e.target === modal) close(); });

        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.flight-link');
            if (!btn) return;
            openFlightDetail(btn.getAttribute('data-flight-id'));
        });
    }

    function openFlightDetail(flightId) {
        var flight = _flights.find(function(f) { return f.ID === flightId; });
        if (!flight) return;
        var order = _orders.find(function(o) { return o.flight_ID === flightId; });
        var supplier = order ? _suppliers.find(function(s) { return s.ID === order.supplier_ID; }) : null;

        var setVal = function(id, val) {
            var el = document.getElementById(id);
            if (el) el.innerHTML = val != null && val !== '' ? val : '<span class="text-muted">--</span>';
        };

        document.getElementById('flightDetailTitle').textContent = 'Flight ' + flight.flight_number;
        document.getElementById('flightDetailSubtitle').textContent =
            sectorIATA(flight.origin_airport, flight.destination_airport) + ' \u2014 ' + flight.flight_date;

        // Identity
        setVal('dtlFlightNum', '<strong>' + flight.flight_number + '</strong>');
        setVal('dtlFlightDate', flight.flight_date);
        setVal('dtlFlightStatus', statusBadge(flight.status));
        setVal('dtlAirline', flight.airline_code || '');
        setVal('dtlServiceType', flight.service_type || '');
        setVal('dtlFlightNature', flight.flight_nature || '');

        // Sector
        setVal('dtlSector', '<strong>' + sectorIATA(flight.origin_airport, flight.destination_airport) + '</strong>');
        setVal('dtlETD', fmtTime(flight.scheduled_departure));
        setVal('dtlETA', fmtTime(flight.scheduled_arrival));
        setVal('dtlBlockTime', fmtBlockMins(flight.planned_block_mins));
        setVal('dtlDepTerm', flight.departure_terminal);
        setVal('dtlArrTerm', flight.arrival_terminal);
        setVal('dtlGate', flight.gate_number);
        setVal('dtlStand', flight.stand_number);
        setVal('dtlLinked', flight.linked_flight_number ? flight.linked_flight_number + ' (' + (flight.linked_flight_date || '') + ')' : '');

        // Aircraft
        setVal('dtlAircraftType', flight.aircraft_type);
        setVal('dtlAircraftReg', flight.aircraft_reg);
        setVal('dtlCaptain', flight.captain_name);

        // Payload
        setVal('dtlBookedPax', flight.booked_passengers != null ? Number(flight.booked_passengers).toLocaleString() : '');
        setVal('dtlBoardedPax', flight.boarded_passengers != null ?
            '<span class="text-success">' + Number(flight.boarded_passengers).toLocaleString() + '</span>' :
            '<span class="text-muted">Pending DCS</span>');
        setVal('dtlCargo', flight.cargo_kg != null ? Number(flight.cargo_kg).toLocaleString() + ' kg' : '');

        // Fuel Order
        setVal('dtlOrderNum', order ? fuelOrderLink(order.order_number) : '');
        setVal('dtlOrderStatus', order ? statusBadge(order.status) : '');
        setVal('dtlOrderQty', order && order.ordered_quantity != null ? Number(order.ordered_quantity).toLocaleString() : '');
        setVal('dtlCrewReview', order && order.crew_review_status ? statusBadge(order.crew_review_status) : '<span class="text-muted">Pending</span>');
        setVal('dtlAdjQty', order && order.crew_adjusted_quantity != null ? Number(order.crew_adjusted_quantity).toLocaleString() : '');
        setVal('dtlSupplier', supplier ? supplier.supplier_name : '');

        document.getElementById('flightDetailModal').style.display = 'flex';
    }

    // Enrich modal
    function initEnrichModal() {
        var modal = document.getElementById('enrichModal');
        var closeBtn = document.getElementById('enrichModalClose');
        var cancelBtn = document.getElementById('enrichCancelBtn');
        var saveBtn = document.getElementById('enrichSaveBtn');
        var statusEl = document.getElementById('enrichSaveStatus');
        if (!modal) return;

        function closeModal() { modal.style.display = 'none'; }
        closeBtn.addEventListener('click', closeModal);
        cancelBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', function(e) { if (e.target === modal) closeModal(); });

        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.btn-enrich');
            if (!btn) return;
            document.getElementById('enrichFlightTitle').textContent = btn.getAttribute('data-flight-number') + ' (' + btn.getAttribute('data-flight-date') + ')';
            document.getElementById('enrichFlightId').value = btn.getAttribute('data-flight-id');
            document.getElementById('enrichAircraftType').value = btn.getAttribute('data-aircraft-type') || '';
            document.getElementById('enrichAircraftReg').value = btn.getAttribute('data-aircraft-reg') || '';
            document.getElementById('enrichDepTerminal').value = btn.getAttribute('data-dep-terminal') || '';
            document.getElementById('enrichArrTerminal').value = btn.getAttribute('data-arr-terminal') || '';
            document.getElementById('enrichGate').value = btn.getAttribute('data-gate') || '';
            document.getElementById('enrichStand').value = btn.getAttribute('data-stand') || '';
            statusEl.style.display = 'none';
            modal.style.display = 'flex';
        });

        saveBtn.addEventListener('click', function() {
            var flightId = document.getElementById('enrichFlightId').value;
            var payload = {
                aircraft_type: document.getElementById('enrichAircraftType').value || null,
                aircraft_reg: document.getElementById('enrichAircraftReg').value || null,
                departure_terminal: document.getElementById('enrichDepTerminal').value || null,
                arrival_terminal: document.getElementById('enrichArrTerminal').value || null,
                gate_number: document.getElementById('enrichGate').value || null,
                stand_number: document.getElementById('enrichStand').value || null
            };
            statusEl.style.display = 'block';
            statusEl.className = 'enrich-status status-loading';
            statusEl.textContent = 'Saving...';
            saveBtn.disabled = true;

            fetch(PLANNING_SVC + '/FlightSchedule(' + flightId + ')', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
            .then(function(res) {
                if (res.ok) {
                    statusEl.className = 'enrich-status status-success';
                    statusEl.textContent = 'Flight enriched successfully!';
                    setTimeout(function() { closeModal(); loadDashboard(); }, 800);
                } else {
                    return res.json().then(function(data) {
                        statusEl.className = 'enrich-status status-error';
                        statusEl.textContent = (data.error && data.error.message) || 'Failed to save.';
                    });
                }
            })
            .catch(function(err) {
                statusEl.className = 'enrich-status status-error';
                statusEl.textContent = 'Network error: ' + err.message;
            })
            .finally(function() { saveBtn.disabled = false; });
        });
    }

    // Cockpit crew — open modal instead of prompts
    function initCockpitActions() {
        document.addEventListener('click', function(e) {
            var confirmBtn = e.target.closest('.btn-confirm');
            var adjustBtn = e.target.closest('.btn-adjust');

            if (confirmBtn || adjustBtn) {
                var btn = confirmBtn || adjustBtn;
                openCrewAdjustModal(btn, !!adjustBtn);
            }
        });
    }

    function openCrewAdjustModal(btn, startInAdjustMode) {
        var modal = document.getElementById('crewAdjustModal');
        if (!modal) return;

        var orderId = btn.getAttribute('data-order-id');
        var flightNum = btn.getAttribute('data-flight');
        var currentQty = Number(btn.getAttribute('data-qty')) || 0;

        // Find order for route info
        var compRow = btn.closest('.comparison-row, .comparison-row-adjusted, .comparison-row-review');
        var routeText = '';
        if (compRow) {
            var routeEl = compRow.querySelector('.flight-route');
            if (routeEl) routeText = routeEl.textContent;
        }

        // Find dispatch and ROB values from the row
        var dispatchQty = '', robQty = '';
        if (compRow) {
            var cells = compRow.querySelectorAll('.qty-cell');
            if (cells.length >= 5) {
                dispatchQty = cells[0].textContent;
                robQty = cells[4].textContent;
            }
        }

        // Populate modal
        document.getElementById('crewOrderId').value = orderId;
        document.getElementById('crewRefFlight').value = flightNum;
        document.getElementById('crewRefRoute').value = routeText;
        document.getElementById('crewRefStatus').value = 'AWAITING_REVIEW';
        document.getElementById('crewQtyDispatch').value = dispatchQty;
        document.getElementById('crewQtyPlanner').value = fmt(currentQty);
        document.getElementById('crewQtyRob').value = robQty;
        document.getElementById('crewAdjustSubtitle').textContent = flightNum + (routeText ? ' — ' + routeText : '');

        // Reset state
        document.getElementById('crewAdjustFields').style.display = 'none';
        document.getElementById('crewNewQty').value = currentQty;
        document.getElementById('crewReasonSelect').value = '';
        document.getElementById('crewCustomReason').value = '';
        document.getElementById('crewCustomReasonRow').style.display = 'none';
        document.getElementById('crewNotes').value = '';
        document.getElementById('crewValidation').style.display = 'none';
        document.getElementById('crewQtyDiff').textContent = '';

        var submitBtn = document.getElementById('crewSubmitBtn');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submit Review';

        // Remove active state from action buttons
        document.getElementById('crewActionConfirm').classList.remove('crew-action-selected');
        document.getElementById('crewActionAdjust').classList.remove('crew-action-selected');

        // Auto-select adjust mode if opened from Adjust button
        if (startInAdjustMode) {
            selectCrewAction('adjust');
        }

        modal.style.display = 'flex';
    }

    var _crewAction = null;

    function selectCrewAction(action) {
        _crewAction = action;
        var confirmBtn = document.getElementById('crewActionConfirm');
        var adjustBtn = document.getElementById('crewActionAdjust');
        var adjustFields = document.getElementById('crewAdjustFields');
        var submitBtn = document.getElementById('crewSubmitBtn');

        confirmBtn.classList.remove('crew-action-selected');
        adjustBtn.classList.remove('crew-action-selected');

        if (action === 'confirm') {
            confirmBtn.classList.add('crew-action-selected');
            adjustFields.style.display = 'none';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Confirm as Planned';
        } else {
            adjustBtn.classList.add('crew-action-selected');
            adjustFields.style.display = '';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Adjustment';
            document.getElementById('crewNewQty').focus();
        }
    }

    function initCrewAdjustModal() {
        var modal = document.getElementById('crewAdjustModal');
        if (!modal) return;

        var closeBtn = document.getElementById('crewAdjustClose');
        var cancelBtn = document.getElementById('crewCancelBtn');
        var submitBtn = document.getElementById('crewSubmitBtn');
        var confirmAction = document.getElementById('crewActionConfirm');
        var adjustAction = document.getElementById('crewActionAdjust');
        var reasonSelect = document.getElementById('crewReasonSelect');
        var newQtyInput = document.getElementById('crewNewQty');

        function closeModal() { modal.style.display = 'none'; _crewAction = null; }
        closeBtn.addEventListener('click', closeModal);
        cancelBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', function(e) { if (e.target === modal) closeModal(); });

        confirmAction.addEventListener('click', function() { selectCrewAction('confirm'); });
        adjustAction.addEventListener('click', function() { selectCrewAction('adjust'); });

        // Show/hide custom reason field
        reasonSelect.addEventListener('change', function() {
            document.getElementById('crewCustomReasonRow').style.display = reasonSelect.value === 'other' ? '' : 'none';
        });

        // Show diff when qty changes
        newQtyInput.addEventListener('input', function() {
            var plannerQty = parseInt(document.getElementById('crewQtyPlanner').value.replace(/,/g, '')) || 0;
            var newQty = parseInt(newQtyInput.value) || 0;
            var diff = newQty - plannerQty;
            var diffEl = document.getElementById('crewQtyDiff');
            if (diff !== 0 && newQty > 0) {
                diffEl.textContent = (diff > 0 ? '+' : '') + fmt(diff) + ' kg from planner';
                diffEl.className = 'crew-qty-diff ' + (diff > 0 ? 'crew-qty-diff-up' : 'crew-qty-diff-down');
            } else {
                diffEl.textContent = '';
            }
        });

        // Submit
        submitBtn.addEventListener('click', function() {
            var orderId = document.getElementById('crewOrderId').value;
            var flightNum = document.getElementById('crewRefFlight').value;
            var validationEl = document.getElementById('crewValidation');

            if (_crewAction === 'confirm') {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Saving...';
                patchCrewReview(orderId, 'CONFIRMED', null, null, flightNum, function() {
                    closeModal();
                });
            } else if (_crewAction === 'adjust') {
                var newQty = Number(newQtyInput.value);
                var reason = reasonSelect.value === 'other' ? document.getElementById('crewCustomReason').value.trim() : reasonSelect.value;
                var notes = document.getElementById('crewNotes').value.trim();

                // Validate
                var errors = [];
                if (!newQty || newQty <= 0) errors.push('New quantity must be greater than 0.');
                if (!reason) errors.push('Reason for adjustment is mandatory.');
                if (reasonSelect.value === 'other' && !document.getElementById('crewCustomReason').value.trim()) errors.push('Please specify the custom reason.');

                if (errors.length > 0) {
                    validationEl.innerHTML = errors.map(function(e) { return '<div class="crew-error">' + e + '</div>'; }).join('');
                    validationEl.style.display = 'block';
                    return;
                }
                validationEl.style.display = 'none';

                submitBtn.disabled = true;
                submitBtn.textContent = 'Saving...';
                patchCrewReview(orderId, 'ADJUSTED', newQty, reason, flightNum, function() {
                    closeModal();
                }, notes);
            }
        });
    }

    function patchCrewReview(orderId, status, adjustedQty, reason, flightNum, onSuccess, notes) {
        var payload = { crew_review_status: status };
        if (status === 'ADJUSTED') {
            payload.crew_adjusted_quantity = adjustedQty;
            payload.crew_adjustment_reason = reason;
        }
        if (notes) payload.crew_notes = notes;
        payload.crew_reviewed_by = 'Cockpit Crew';
        payload.crew_reviewed_at = new Date().toISOString();

        fetch(ORDER_SVC + '/FuelOrders(' + orderId + ')', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(function(res) {
            if (res.ok) {
                if (onSuccess) onSuccess();
                loadDashboard();
            } else {
                return res.json().then(function(data) {
                    var validationEl = document.getElementById('crewValidation');
                    if (validationEl) {
                        validationEl.innerHTML = '<div class="crew-error">Failed: ' + ((data.error && data.error.message) || 'Unknown error') + '</div>';
                        validationEl.style.display = 'block';
                    }
                    document.getElementById('crewSubmitBtn').disabled = false;
                    document.getElementById('crewSubmitBtn').textContent = 'Submit Review';
                });
            }
        })
        .catch(function(err) {
            var validationEl = document.getElementById('crewValidation');
            if (validationEl) {
                validationEl.innerHTML = '<div class="crew-error">Network error: ' + err.message + '</div>';
                validationEl.style.display = 'block';
            }
            document.getElementById('crewSubmitBtn').disabled = false;
            document.getElementById('crewSubmitBtn').textContent = 'Submit Review';
        });
    }

    // Upload handlers
    function initUploads() {
        initFileUpload('uploadArea', 'scheduleFile', 'browseBtn', 'uploadStatus', 'uploadProgress', 'uploadMessage',
            function(base64, fileName, showResult) {
                fetch(PLANNING_SVC + '/importFlightScheduleExcel', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fileContent: base64, fileName: fileName })
                })
                .then(function(res) { return res.json().then(function(data) { return { ok: res.ok, data: data }; }); })
                .then(function(result) {
                    if (result.ok && result.data.success) {
                        showResult('success', result.data.message || 'Upload successful');
                        loadDashboard();
                    } else {
                        showResult('error', (result.data.error && result.data.error.message) || 'Upload failed');
                    }
                })
                .catch(function(err) { showResult('error', 'Network error: ' + err.message); });
            });

        initFileUpload('dispatchArea', 'dispatchFile', 'dispatchBrowseBtn', 'dispatchUploadStatus', 'dispatchUploadProgress', 'dispatchUploadMessage',
            function(base64, fileName, showResult) {
                fetch(ORDER_SVC + '/importFlightDispatchExcel', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fileContent: base64, fileName: fileName })
                })
                .then(function(res) { return res.json().then(function(data) { return { ok: res.ok, data: data }; }); })
                .then(function(result) {
                    if (result.ok && result.data.success) {
                        showResult('success', result.data.message || 'Dispatch import successful');
                        loadDashboard();
                    } else {
                        showResult('error', (result.data.error && result.data.error.message) || 'Import failed');
                    }
                })
                .catch(function(err) { showResult('error', 'Network error: ' + err.message); });
            });
    }

    function initFileUpload(areaId, fileId, btnId, statusId, progressId, messageId, onUpload) {
        var area = document.getElementById(areaId);
        var fileInput = document.getElementById(fileId);
        var browseBtn = document.getElementById(btnId);
        var uploadStatus = document.getElementById(statusId);
        var uploadProgress = document.getElementById(progressId);
        var uploadMessage = document.getElementById(messageId);
        if (!area || !fileInput) return;

        browseBtn.addEventListener('click', function(e) { e.stopPropagation(); fileInput.click(); });
        area.addEventListener('click', function() { fileInput.click(); });
        area.addEventListener('dragover', function(e) { e.preventDefault(); area.classList.add('drag-over'); });
        area.addEventListener('dragleave', function() { area.classList.remove('drag-over'); });
        area.addEventListener('drop', function(e) {
            e.preventDefault(); area.classList.remove('drag-over');
            if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
        });
        fileInput.addEventListener('change', function() { if (fileInput.files.length > 0) handleFile(fileInput.files[0]); });

        function handleFile(file) {
            showResult('loading', 'Uploading "' + file.name + '"...');
            var reader = new FileReader();
            reader.onload = function(e) {
                var base64 = e.target.result.split(',')[1];
                onUpload(base64, file.name, showResult);
            };
            reader.readAsDataURL(file);
        }

        function showResult(type, message) {
            uploadStatus.style.display = 'block';
            uploadProgress.className = 'upload-progress upload-' + type;
            uploadMessage.innerHTML = message.replace(/\n/g, '<br>');
            if (type === 'success') setTimeout(function() { uploadStatus.style.display = 'none'; }, 8000);
        }
    }

    // Persona filtering — controls what each role can see
    function initPersona() {
        var selector = document.getElementById('personaSelector');
        if (!selector) return;
        selector.addEventListener('change', function() {
            currentPersona = selector.value;
            loadDashboard(); // Reload to rebuild comparison with actions
        });
    }

    function applyPersona(persona) {
        var kpiSection = document.querySelector('.kpi-section');
        var workflowSection = document.querySelector('.workflow-section');
        var flightTableSection = document.querySelector('.tables-section');
        var dispatchUploadSection = document.getElementById('dispatchUploadSection');

        // Column emphasis
        var dispatchCells = document.querySelectorAll('.qty-dispatch');
        var plannerCells = document.querySelectorAll('.qty-planner');
        var cockpitCells = document.querySelectorAll('.qty-cockpit');
        dispatchCells.forEach(function(c) { c.style.fontWeight = ''; c.style.fontSize = ''; });
        plannerCells.forEach(function(c) { c.style.fontWeight = ''; c.style.fontSize = ''; });
        cockpitCells.forEach(function(c) { c.style.fontWeight = ''; c.style.fontSize = ''; });

        if (persona === 'all') {
            // All Roles: show everything
            if (kpiSection) kpiSection.style.display = '';
            if (workflowSection) workflowSection.style.display = '';
            if (flightTableSection) flightTableSection.style.display = '';
            if (dispatchUploadSection) dispatchUploadSection.style.display = '';
        } else if (persona === 'planner') {
            // Fuel Planner: KPIs, workflow, schedule upload, enrich, comparison (planner col)
            if (kpiSection) kpiSection.style.display = '';
            if (workflowSection) workflowSection.style.display = '';
            if (flightTableSection) flightTableSection.style.display = '';
            if (dispatchUploadSection) dispatchUploadSection.style.display = 'none';
            plannerCells.forEach(function(c) { c.style.fontWeight = '800'; c.style.fontSize = '16px'; });
        } else if (persona === 'dispatch') {
            // Dispatch Team: comparison (dispatch col) + dispatch upload only
            if (kpiSection) kpiSection.style.display = 'none';
            if (workflowSection) workflowSection.style.display = 'none';
            if (flightTableSection) flightTableSection.style.display = 'none';
            if (dispatchUploadSection) dispatchUploadSection.style.display = '';
            dispatchCells.forEach(function(c) { c.style.fontWeight = '800'; c.style.fontSize = '16px'; });
        } else if (persona === 'cockpit') {
            // Cockpit Crew: comparison only (cockpit col + confirm/adjust)
            if (kpiSection) kpiSection.style.display = 'none';
            if (workflowSection) workflowSection.style.display = 'none';
            if (flightTableSection) flightTableSection.style.display = 'none';
            if (dispatchUploadSection) dispatchUploadSection.style.display = 'none';
            cockpitCells.forEach(function(c) { c.style.fontWeight = '800'; c.style.fontSize = '16px'; });
        }
    }

    function init() {
        loadDashboard();
        initEnrichModal();
        initCrewAdjustModal();
        initUploads();
        initPersona();
        initCockpitActions();
        initFilters();
        initFlightDetail();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
