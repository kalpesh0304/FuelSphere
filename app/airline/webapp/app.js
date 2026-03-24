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

        // Use all orders — no airline filtering
        const allOrders = orders;

        // ====================================================================
        // JOURNEY TIMELINE COUNTS
        // ====================================================================

        // Step 1: Flights without orders
        const flightsWithOrders = new Set(orders.filter(function(o) { return o.flight_ID; }).map(function(o) { return o.flight_ID; }));
        var step1 = flights.filter(function(f) { return !flightsWithOrders.has(f.ID); }).length;

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
        // FLIGHTS TABLE
        // ====================================================================

        var flightsBody = document.getElementById('flightsBody');
        if (flightsBody) {
            if (flights.length === 0) {
                flightsBody.innerHTML = '<tr><td colspan="7" class="loading">No flights found</td></tr>';
            } else {
                flightsBody.innerHTML = flights.map(function(f) {
                    var hasOrder = flightsWithOrders.has(f.ID);
                    return '<tr>' +
                        '<td><strong>' + f.flight_number + '</strong></td>' +
                        '<td>' + f.flight_date + '</td>' +
                        '<td>' + f.origin_airport + ' \u2192 ' + f.destination_airport + '</td>' +
                        '<td>' + (f.aircraft_type || '\u2014') + '</td>' +
                        '<td>' + (f.aircraft_reg || '\u2014') + '</td>' +
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
                    var msg = d.message || ('Successfully imported ' + (d.recordsCreated || 0) + ' flight(s).');
                    if (d.recordsSkipped) msg += ' ' + d.recordsSkipped + ' skipped.';
                    showUploadResult('success', msg);
                    // Reload dashboard to show new flights
                    loadDashboard();
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
            uploadMessage.textContent = message;

            if (type === 'success') {
                setTimeout(function() { uploadStatus.style.display = 'none'; }, 8000);
            }
        }
    }

    // ========================================================================
    // INIT
    // ========================================================================

    function init() {
        loadDashboard();
        initUpload();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
