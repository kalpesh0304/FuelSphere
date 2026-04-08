/* FuelSphere Planning App — app.js */
(function () {
    'use strict';

    var ORDER_SVC = '/odata/v4/orders';
    var PLANNING_SVC = '/odata/v4/planning';
    var FUEL_ORDER_APP = 'https://glcmjmynl0mfp4nx.launchpad.cfapps.eu10.hana.ondemand.com/91d3cd79-fbcd-42e1-bb4b-591d8070935e.comfuelspherefuelorders.comfuelspherefuelorders-0.0.1/index.html';
    var currentPersona = 'all';

    function fuelOrderLink(orderNum, orderId) {
        if (!orderNum || !orderId) return '--';
        return '<a href="' + FUEL_ORDER_APP + '#/FuelOrders(ID=' + orderId + ',IsActiveEntity=true)" target="_blank" class="fo-link">' + orderNum + '</a>';
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
        var [orders, flights, dispatches] = await Promise.all([
            odata(ORDER_SVC + '/FuelOrders?$orderby=requested_date desc'),
            odata(ORDER_SVC + '/FlightSchedule?$orderby=flight_date desc,scheduled_departure asc'),
            odata(ORDER_SVC + '/FlightDispatches?$top=500')
        ]);

        var filteredFlights = flights.filter(function(f) { return !isPRFlight(f); });
        var allOrders = orders.filter(function(o) {
            var flight = flights.find(function(f) { return f.ID === o.flight_ID; });
            if (!flight) return true;
            return !isPRFlight(flight);
        });

        // KPIs
        var flightsWithOrders = new Set(allOrders.filter(function(o) { return o.flight_ID; }).map(function(o) { return o.flight_ID; }));
        // Build flight → order lookup (number + ID for deep link)
        var flightOrderMap = {};
        allOrders.forEach(function(o) {
            if (o.flight_ID && o.order_number) flightOrderMap[o.flight_ID] = { num: o.order_number, id: o.ID };
        });

        // "Flights Needing Fuel Plan" = SCHEDULED flights that have NO fuel order yet
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
                        '<div class="flight-info"><span class="flight-number">' + flightNum + '</span><span class="flight-route">' + route + '</span></div>' +
                        '<div class="qty-cell qty-dispatch">' + fmt(Math.round(dispatchQty)) + '</div>' +
                        '<div class="qty-cell qty-planner">' + fmt(Math.round(plannerQty)) + '</div>' +
                        '<div class="qty-cell qty-cockpit">' + fmt(Math.round(cockpitQty)) + '</div>' +
                        '<div class="qty-cell qty-uplift">' + fmt(Math.round(netUplift)) + '</div>' +
                        '<div class="qty-cell qty-rob">' + fmt(Math.round(robKg)) + '</div>' +
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

        // Flights table — only SCHEDULED
        var scheduledFlights = filteredFlights.filter(function(f) { return f.status === 'SCHEDULED'; });
        var flightsBody = document.getElementById('flightsBody');
        if (flightsBody) {
            if (scheduledFlights.length === 0) {
                flightsBody.innerHTML = '<tr><td colspan="8" class="loading">No scheduled flights found</td></tr>';
            } else {
                // Show/hide enrich column based on persona
                var showEnrich = (currentPersona === 'all' || currentPersona === 'planner');
                flightsBody.innerHTML = scheduledFlights.map(function(f) {
                    var hasOrder = flightsWithOrders.has(f.ID);
                    var needsEnrich = !f.aircraft_type || !f.aircraft_reg;
                    return '<tr>' +
                        '<td><strong>' + f.flight_number + '</strong></td>' +
                        '<td>' + f.flight_date + '</td>' +
                        '<td>' + (f.origin_airport || '--') + ' \u2192 ' + (f.destination_airport || '--') + '</td>' +
                        '<td>' + (f.aircraft_type || '<span class="badge badge-draft">Not Set</span>') + '</td>' +
                        '<td>' + (f.aircraft_reg || '<span class="badge badge-draft">Not Set</span>') + '</td>' +
                        '<td>' + statusBadge(f.status) + '</td>' +
                        '<td>' + (hasOrder ? fuelOrderLink(flightOrderMap[f.ID].num, flightOrderMap[f.ID].id) : '<span class="badge badge-pending">—</span>') + '</td>' +
                        (showEnrich ?
                            '<td><button class="btn-enrich' + (needsEnrich ? ' btn-enrich-needed' : '') + '" data-flight-id="' + f.ID + '" ' +
                            'data-flight-number="' + f.flight_number + '" ' +
                            'data-flight-date="' + f.flight_date + '" ' +
                            'data-aircraft-type="' + (f.aircraft_type || '') + '" ' +
                            'data-aircraft-reg="' + (f.aircraft_reg || '') + '" ' +
                            'data-dep-terminal="' + (f.departure_terminal || '') + '" ' +
                            'data-arr-terminal="' + (f.arrival_terminal || '') + '" ' +
                            'data-gate="' + (f.gate_number || '') + '" ' +
                            'data-stand="' + (f.stand_number || '') + '"' +
                            '>' + (needsEnrich ? 'Enrich Now' : 'Edit') + '</button></td>' :
                            '<td>--</td>') +
                        '</tr>';
                }).join('');
            }
        }

        // Apply persona visibility after data loads
        applyPersona(currentPersona);
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
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
