/* FuelSphere Airline Dashboard — app.js */
(function () {
    'use strict';

    // OData base paths
    const ORDER_SVC = '/odata/v4/orders';
    const PLANNING_SVC = '/odata/v4/planning';

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
            if (order.s4_po_number) return 7;
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
        // Fetch ALL orders and flights (no airline filter)
        const [orders, flights, invoices] = await Promise.all([
            odata(ORDER_SVC + '/FuelOrders?$orderby=requested_date desc'),
            odata(ORDER_SVC + '/FlightSchedule?$orderby=flight_date desc,scheduled_departure asc'),
            odata('/odata/v4/invoice/Invoices?$top=200')
        ]);

        // Filter out PR (Philippine Airlines) data
        function isPRFlight(f) {
            if (f.airline_code === 'PR') return true;
            if (f.flight_number && f.flight_number.substring(0, 2) === 'PR') return true;
            return false;
        }
        var filteredFlights = flights.filter(function(f) { return !isPRFlight(f); });
        const allOrders = orders.filter(function(o) {
            var flight = flights.find(function(f) { return f.ID === o.flight_ID; });
            if (!flight) return true; // Keep orders without flight link
            return !isPRFlight(flight);
        });

        // ====================================================================
        // JOURNEY TIMELINE COUNTS
        // ====================================================================

        // Step 1: Flights without orders (using filtered flights)
        const flightsWithOrders = new Set(allOrders.filter(function(o) { return o.flight_ID; }).map(function(o) { return o.flight_ID; }));
        var step1 = filteredFlights.filter(function(f) { return !flightsWithOrders.has(f.ID); }).length;

        // Step 2: Draft/Submitted orders
        var step2 = allOrders.filter(function(o) { return o.status === 'Draft' || o.status === 'Submitted'; }).length;

        // Step 3: Confirmed orders (no crew review yet)
        var step3 = allOrders.filter(function(o) { return o.status === 'Confirmed' && !o.crew_review_status; }).length;

        // Step 4: Crew reviewed
        var step4 = allOrders.filter(function(o) { return (o.crew_review_status === 'CONFIRMED' || o.crew_review_status === 'ADJUSTED') && o.status === 'Confirmed'; }).length;

        // Step 5: InProgress (refueling)
        var step5 = allOrders.filter(function(o) { return o.status === 'InProgress'; }).length;

        // Step 6: Delivered (ticket signed)
        var step6 = allOrders.filter(function(o) { return o.status === 'Delivered'; }).length;

        // Step 7: Completed (invoice settled)
        var step7 = allOrders.filter(function(o) { return o.status === 'Completed'; }).length;

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

        var activeOrders = allOrders.filter(function(o) { return o.status !== 'Cancelled' && o.status !== 'Completed'; }).length;
        var crewPending = allOrders.filter(function(o) { return o.status === 'Confirmed' && (!o.crew_review_status || o.crew_review_status === 'PENDING'); }).length;
        var deliveriesInProgress = allOrders.filter(function(o) { return o.status === 'InProgress'; }).length;
        var deliveredCompleted = allOrders.filter(function(o) { return o.status === 'Delivered' || o.status === 'Completed'; }).length;

        setText('kpiActiveOrders', activeOrders);
        setText('kpiCrewPending', crewPending);
        setText('kpiDeliveries', deliveriesInProgress);
        setText('kpiCompleted', deliveredCompleted);

        // ====================================================================
        // ORDERS TABLE
        // ====================================================================

        var ordersBody = document.getElementById('ordersBody');
        if (ordersBody) {
            if (allOrders.length === 0) {
                ordersBody.innerHTML = '<tr><td colspan="8" class="loading">No fuel orders found</td></tr>';
            } else {
                ordersBody.innerHTML = allOrders.map(function(o) {
                    var flight = flights.find(function(f) { return f.ID === o.flight_ID; });
                    var route = flight ? (flight.origin_airport + ' \u2192 ' + flight.destination_airport) : '\u2014';
                    var flightNum = flight ? flight.flight_number : '\u2014';
                    var step = journeyStep(o);
                    return '<tr>' +
                        '<td><strong>' + (o.order_number || '\u2014') + '</strong></td>' +
                        '<td>' + flightNum + '</td>' +
                        '<td>' + route + '</td>' +
                        '<td>' + (o.requested_date || '\u2014') + '</td>' +
                        '<td>' + fmt(o.ordered_quantity) + '</td>' +
                        '<td>' + statusBadge(o.status) + '</td>' +
                        '<td>' + crewBadge(o.crew_review_status) + '</td>' +
                        '<td>' + stepBadge(step) + '</td>' +
                        '</tr>';
                }).join('');
            }
        }

        // ====================================================================
        // FLIGHTS TABLE (using filtered flights)
        // ====================================================================

        var flightsBody = document.getElementById('flightsBody');
        if (flightsBody) {
            if (filteredFlights.length === 0) {
                flightsBody.innerHTML = '<tr><td colspan="10" class="loading">No flights found</td></tr>';
            } else {
                flightsBody.innerHTML = filteredFlights.map(function(f) {
                    var hasOrder = flightsWithOrders.has(f.ID);
                    var depTerm = f.departure_terminal || '\u2014';
                    var arrTerm = f.arrival_terminal || '\u2014';
                    var terminal = depTerm + ' / ' + arrTerm;
                    if (!f.departure_terminal && !f.arrival_terminal) terminal = '\u2014';
                    return '<tr>' +
                        '<td><strong>' + f.flight_number + '</strong></td>' +
                        '<td>' + f.flight_date + '</td>' +
                        '<td>' + f.origin_airport + ' \u2192 ' + f.destination_airport + '</td>' +
                        '<td>' + (f.aircraft_type || '\u2014') + '</td>' +
                        '<td>' + (f.aircraft_reg || '\u2014') + '</td>' +
                        '<td>' + terminal + '</td>' +
                        '<td>' + (f.gate_number || '\u2014') + '</td>' +
                        '<td>' + statusBadge(f.status) + '</td>' +
                        '<td>' + (hasOrder
                            ? '<span class="badge badge-confirmed">Yes</span>'
                            : '<span class="badge badge-draft">No</span>') + '</td>' +
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

    function setText(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = val != null ? val : '\u2014';
    }

    // ========================================================================
    // FLIGHT SCHEDULE UPLOAD
    // ========================================================================

    function initUpload() {
        var uploadArea = document.getElementById('uploadArea');
        var fileInput = document.getElementById('scheduleFile');
        var browseBtn = document.getElementById('browseBtn');
        var uploadStatus = document.getElementById('uploadStatus');
        var uploadMessage = document.getElementById('uploadMessage');
        var uploadProgress = document.getElementById('uploadProgress');

        if (!uploadArea || !fileInput) return;

        // Browse button click
        browseBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            fileInput.click();
        });

        // Click on upload area
        uploadArea.addEventListener('click', function() {
            fileInput.click();
        });

        // Drag & drop
        uploadArea.addEventListener('dragover', function(e) {
            e.preventDefault();
            uploadArea.classList.add('drag-over');
        });
        uploadArea.addEventListener('dragleave', function() {
            uploadArea.classList.remove('drag-over');
        });
        uploadArea.addEventListener('drop', function(e) {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
            if (e.dataTransfer.files.length > 0) {
                handleFile(e.dataTransfer.files[0]);
            }
        });

        // File input change
        fileInput.addEventListener('change', function() {
            if (fileInput.files.length > 0) {
                handleFile(fileInput.files[0]);
            }
        });

        function handleFile(file) {
            var validExts = ['.xlsx', '.xls', '.csv'];
            var ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
            if (validExts.indexOf(ext) === -1) {
                showUploadResult('error', 'Invalid file format. Please upload .xlsx, .xls, or .csv files.');
                return;
            }

            showUploadResult('loading', 'Uploading "' + file.name + '"...');

            var reader = new FileReader();
            reader.onload = function(e) {
                var base64 = e.target.result.split(',')[1];
                uploadSchedule(base64, file.name);
            };
            reader.readAsDataURL(file);
        }

        function uploadSchedule(base64Content, fileName) {
            fetch(PLANNING_SVC + '/importFlightScheduleExcel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileContent: base64Content,
                    fileName: fileName
                })
            })
            .then(function(res) { return res.json().then(function(data) { return { ok: res.ok, data: data }; }); })
            .then(function(result) {
                if (result.ok) {
                    var d = result.data;
                    var msg = d.message || ('Processed. Flights: ' + (d.flightsCreated || 0) + ' created, ' + (d.flightsUpdated || 0) + ' updated.');
                    var type = d.success ? 'success' : 'warning';
                    // Show row-level errors if any
                    if (d.errors && d.errors.length > 0) {
                        var errorDetails = d.errors.filter(function(e) { return e.severity === 'ERROR'; });
                        if (errorDetails.length > 0) {
                            msg += '\n\nErrors:';
                            errorDetails.forEach(function(e) {
                                msg += '\n  Row ' + e.row + ': ' + e.message;
                            });
                            type = 'error';
                        }
                    }
                    showUploadResult(type, msg);
                    if (d.flightsCreated > 0 || d.flightsUpdated > 0) {
                        loadDashboard();
                    }
                } else {
                    var errMsg = result.data.error ? result.data.error.message : 'Upload failed. Please check the file format.';
                    showUploadResult('error', errMsg);
                }
            })
            .catch(function(err) {
                showUploadResult('error', 'Network error: ' + err.message);
            });
        }

        function showUploadResult(type, message) {
            uploadStatus.style.display = 'block';
            uploadProgress.className = 'upload-progress upload-' + type;
            // Support multiline messages with line breaks
            uploadMessage.innerHTML = message.replace(/\n/g, '<br>');

            if (type === 'success') {
                setTimeout(function() { uploadStatus.style.display = 'none'; }, 8000);
            }
        }
    }

    // ========================================================================
    // FLIGHT ENRICHMENT — INLINE MODAL (per-flight editing)
    // ========================================================================

    function initEnrichModal() {
        var modal = document.getElementById('enrichModal');
        var closeBtn = document.getElementById('enrichModalClose');
        var cancelBtn = document.getElementById('enrichCancelBtn');
        var saveBtn = document.getElementById('enrichSaveBtn');
        var statusEl = document.getElementById('enrichSaveStatus');

        if (!modal) return;

        // Close modal
        function closeModal() { modal.style.display = 'none'; }
        closeBtn.addEventListener('click', closeModal);
        cancelBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', function(e) {
            if (e.target === modal) closeModal();
        });

        // Open modal from enrich button click (event delegation)
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.btn-enrich');
            if (!btn) return;

            var flightId = btn.getAttribute('data-flight-id');
            var flightNum = btn.getAttribute('data-flight-number');
            var flightDate = btn.getAttribute('data-flight-date');

            document.getElementById('enrichFlightTitle').textContent = flightNum + ' (' + flightDate + ')';
            document.getElementById('enrichFlightId').value = flightId;
            document.getElementById('enrichAircraftType').value = btn.getAttribute('data-aircraft-type') || '';
            document.getElementById('enrichAircraftReg').value = btn.getAttribute('data-aircraft-reg') || '';
            document.getElementById('enrichDepTerminal').value = btn.getAttribute('data-dep-terminal') || '';
            document.getElementById('enrichArrTerminal').value = btn.getAttribute('data-arr-terminal') || '';
            document.getElementById('enrichGate').value = btn.getAttribute('data-gate') || '';
            document.getElementById('enrichStand').value = btn.getAttribute('data-stand') || '';
            statusEl.style.display = 'none';

            modal.style.display = 'flex';
        });

        // Save enrichment via OData PATCH
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
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
            .then(function(res) {
                if (res.ok) {
                    statusEl.className = 'enrich-status status-success';
                    statusEl.textContent = 'Flight enriched successfully!';
                    setTimeout(function() {
                        closeModal();
                        loadDashboard();
                    }, 800);
                } else {
                    return res.json().then(function(data) {
                        var msg = (data.error && data.error.message) || 'Failed to save enrichment.';
                        statusEl.className = 'enrich-status status-error';
                        statusEl.textContent = msg;
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

    // ========================================================================
    // DISPATCH DATA UPLOAD
    // ========================================================================

    function initDispatchUpload() {
        var dispatchArea = document.getElementById('dispatchArea');
        var fileInput = document.getElementById('dispatchFile');
        var browseBtn = document.getElementById('dispatchBrowseBtn');
        var uploadStatus = document.getElementById('dispatchUploadStatus');
        var uploadMessage = document.getElementById('dispatchUploadMessage');
        var uploadProgress = document.getElementById('dispatchUploadProgress');

        if (!dispatchArea || !fileInput) return;

        browseBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            fileInput.click();
        });

        dispatchArea.addEventListener('click', function() { fileInput.click(); });

        dispatchArea.addEventListener('dragover', function(e) {
            e.preventDefault();
            dispatchArea.classList.add('drag-over');
        });
        dispatchArea.addEventListener('dragleave', function() {
            dispatchArea.classList.remove('drag-over');
        });
        dispatchArea.addEventListener('drop', function(e) {
            e.preventDefault();
            dispatchArea.classList.remove('drag-over');
            if (e.dataTransfer.files.length > 0) handleDispatchFile(e.dataTransfer.files[0]);
        });

        fileInput.addEventListener('change', function() {
            if (fileInput.files.length > 0) handleDispatchFile(fileInput.files[0]);
        });

        function handleDispatchFile(file) {
            var validExts = ['.xlsx', '.xls', '.csv'];
            var ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
            if (validExts.indexOf(ext) === -1) {
                showResult('error', 'Invalid file format. Please upload .xlsx, .xls, or .csv files.');
                return;
            }
            showResult('loading', 'Importing dispatch data from "' + file.name + '"...');

            var reader = new FileReader();
            reader.onload = function(e) {
                var base64 = e.target.result.split(',')[1];
                fetch(ORDER_SVC + '/importFlightDispatchExcel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fileContent: base64, fileName: file.name })
                })
                .then(function(res) { return res.json().then(function(data) { return { ok: res.ok, data: data }; }); })
                .then(function(result) {
                    if (result.ok) {
                        var d = result.data;
                        var msg = d.message || ('Dispatches: ' + (d.dispatchesCreated || 0) + ' created. Orders updated: ' + (d.ordersUpdated || 0));
                        var type = d.success ? 'success' : 'warning';
                        if (d.errors && d.errors.length > 0) {
                            var errorDetails = d.errors.filter(function(e) { return e.severity === 'ERROR'; });
                            if (errorDetails.length > 0) {
                                msg += '\n\nErrors:';
                                errorDetails.forEach(function(e) { msg += '\n  Row ' + e.row + ': ' + e.message; });
                                type = 'error';
                            }
                        }
                        showResult(type, msg);
                        if (d.dispatchesCreated > 0) loadDashboard();
                    } else {
                        var errMsg = result.data.error ? result.data.error.message : 'Dispatch import failed.';
                        showResult('error', errMsg);
                    }
                })
                .catch(function(err) { showResult('error', 'Network error: ' + err.message); });
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

    // ========================================================================
    // INIT
    // ========================================================================

    function init() {
        loadDashboard();
        initUpload();
        initEnrichModal();
        initDispatchUpload();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
