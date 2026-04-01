/* FuelSphere Planning App — app.js */
(function () {
    'use strict';

    var ORDER_SVC = '/odata/v4/orders';
    var PLANNING_SVC = '/odata/v4/planning';

    function fmt(n) { return n == null ? '--' : Number(n).toLocaleString(); }

    function statusBadge(status) {
        if (!status) return '';
        var cls = {
            Draft: 'badge-draft', Submitted: 'badge-submitted',
            Confirmed: 'badge-confirmed', InProgress: 'badge-inprogress',
            Delivered: 'badge-delivered', Completed: 'badge-completed',
            Cancelled: 'badge-cancelled', SCHEDULED: 'badge-scheduled',
            ARRIVED: 'badge-arrived', DEPARTED: 'badge-departed',
            PENDING: 'badge-pending', ADJUSTED: 'badge-adjusted'
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

    // Filter out PR flights
    function isPRFlight(f) {
        return f.airline_code === 'PR' || (f.flight_number && f.flight_number.substring(0, 2) === 'PR');
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
        var needsPlan = filteredFlights.filter(function(f) { return !flightsWithOrders.has(f.ID) && f.status === 'SCHEDULED'; }).length;
        var pendingReview = allOrders.filter(function(o) { return o.status === 'Confirmed' && (!o.crew_review_status || o.crew_review_status === 'PENDING'); }).length;
        var pilotOverrides = allOrders.filter(function(o) { return o.crew_review_status === 'ADJUSTED'; }).length;
        var confirmed = allOrders.filter(function(o) { return o.crew_review_status === 'CONFIRMED'; }).length;

        setText('kpiFlightsToday', needsPlan);
        setText('kpiPendingReview', pendingReview);
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

                    var dispatchQty = dispatch ? (dispatch.dispatch_quantity_kg || o.ordered_quantity) : o.ordered_quantity;
                    var plannerQty = o.ordered_quantity || 0;
                    var cockpitQty = o.crew_review_status === 'ADJUSTED' ? (o.crew_adjusted_quantity || plannerQty) : plannerQty;
                    var robKg = dispatch ? (dispatch.rob_departure_kg || 0) : 0;
                    var netUplift = Math.max(0, cockpitQty - robKg);

                    var crewStatus = o.crew_review_status || 'PENDING';

                    html += '<div class="comparison-row">' +
                        '<div class="flight-info"><span class="flight-number">' + flightNum + '</span><span class="flight-route">' + route + '</span></div>' +
                        '<div class="qty-cell qty-dispatch">' + fmt(Math.round(dispatchQty)) + '</div>' +
                        '<div class="qty-cell qty-planner">' + fmt(Math.round(plannerQty)) + '</div>' +
                        '<div class="qty-cell qty-cockpit">' + fmt(Math.round(cockpitQty)) + '</div>' +
                        '<div class="qty-cell qty-uplift">' + fmt(Math.round(netUplift)) + '</div>' +
                        '<div class="qty-cell qty-rob">' + fmt(Math.round(robKg)) + '</div>' +
                        '<div>' + statusBadge(crewStatus) + '</div>' +
                        '</div>';
                });
                compBody.innerHTML = html;
            }
        }

        // Pilot override section
        var overrides = allOrders.filter(function(o) { return o.crew_review_status === 'ADJUSTED'; });
        var overrideSection = document.getElementById('overrideSection');
        var overrideList = document.getElementById('overrideList');
        if (overrides.length > 0 && overrideSection && overrideList) {
            overrideSection.style.display = 'block';
            overrideList.innerHTML = overrides.map(function(o) {
                var flight = flights.find(function(f) { return f.ID === o.flight_ID; });
                var flightNum = flight ? flight.flight_number : '--';
                var diff = (o.crew_adjusted_quantity || 0) - (o.ordered_quantity || 0);
                var diffStr = diff >= 0 ? '+' + fmt(diff) : fmt(diff);
                return '<div class="override-card">' +
                    '<div class="override-flight">' + flightNum + '</div>' +
                    '<div class="override-diff">' + diffStr + ' kg</div>' +
                    '<div class="override-reason"><input type="text" placeholder="Pilot override reason (mandatory)" value="' + (o.crew_override_reason || '') + '" readonly></div>' +
                    '</div>';
            }).join('');
        }

        // Flights table
        var flightsBody = document.getElementById('flightsBody');
        if (flightsBody) {
            if (filteredFlights.length === 0) {
                flightsBody.innerHTML = '<tr><td colspan="8" class="loading">No flights found</td></tr>';
            } else {
                flightsBody.innerHTML = filteredFlights.map(function(f) {
                    var hasOrder = flightsWithOrders.has(f.ID);
                    return '<tr>' +
                        '<td><strong>' + f.flight_number + '</strong></td>' +
                        '<td>' + f.flight_date + '</td>' +
                        '<td>' + (f.origin_airport || '--') + ' \u2192 ' + (f.destination_airport || '--') + '</td>' +
                        '<td>' + (f.aircraft_type || '--') + '</td>' +
                        '<td>' + (f.aircraft_reg || '--') + '</td>' +
                        '<td>' + statusBadge(f.status) + '</td>' +
                        '<td>' + (hasOrder ? '<span class="badge badge-confirmed">Yes</span>' : '<span class="badge badge-draft">No</span>') + '</td>' +
                        '<td><button class="btn-enrich" data-flight-id="' + f.ID + '" ' +
                            'data-flight-number="' + f.flight_number + '" ' +
                            'data-flight-date="' + f.flight_date + '" ' +
                            'data-aircraft-type="' + (f.aircraft_type || '') + '" ' +
                            'data-aircraft-reg="' + (f.aircraft_reg || '') + '" ' +
                            'data-dep-terminal="' + (f.departure_terminal || '') + '" ' +
                            'data-arr-terminal="' + (f.arrival_terminal || '') + '" ' +
                            'data-gate="' + (f.gate_number || '') + '" ' +
                            'data-stand="' + (f.stand_number || '') + '"' +
                            '>Enrich</button></td>' +
                        '</tr>';
                }).join('');
            }
        }
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

    // Upload handlers
    function initUploads() {
        // Schedule upload
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

        // Dispatch upload
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

    function init() {
        loadDashboard();
        initEnrichModal();
        initUploads();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
