/* FuelSphere Fulfillment App — app.js */
(function () {
    'use strict';

    var REFUELER_SVC = '/odata/v4/refueler';
    var ORDER_SVC = '/odata/v4/orders';
    var FUEL_ORDER_APP = 'https://glcmjmynl0mfp4nx.launchpad.cfapps.eu10.hana.ondemand.com/91d3cd79-fbcd-42e1-bb4b-591d8070935e.comfuelspherefuelorders.comfuelspherefuelorders-0.0.1/index.html';
    var currentPersona = 'all';

    function fuelOrderLink(orderNum, orderId) {
        if (!orderNum || !orderId) return '--';
        return '<a href="' + FUEL_ORDER_APP + '#/FuelOrders(ID=' + orderId + ',IsActiveEntity=true)" target="_blank" class="fo-link">' + orderNum + '</a>';
    }

    // Cache for cross-referencing
    var _fuelOrders = [];
    var _deliveries = [];
    var _tickets = [];

    function fmt(n) { return n == null ? '--' : Number(n).toLocaleString(); }
    function fmtDate(d) {
        if (!d) return '--';
        var dt = new Date(d);
        return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    function fmtTime(t) { return t ? t.substring(0, 5) : ''; }

    function statusBadge(status) {
        if (!status) return '<span class="badge badge-closed">Unknown</span>';
        var cssClass = 'badge-' + status.toLowerCase().replace(/ /g, '_');
        return '<span class="badge ' + cssClass + '">' + status.replace(/_/g, ' ') + '</span>';
    }

    function setText(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = val != null ? val : '--';
    }

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
        } catch (e) { console.error('OData error:', url, e); return []; }
    }

    // Extract flight number from order notes
    function getFlightFromOrder(order) {
        if (order.notes) {
            var match = order.notes.match(/for (AC\d+)/);
            if (match) return match[1];
        }
        return '';
    }

    async function loadDashboard() {
        var [salesOrders, fuelOrders, deliveries, tickets] = await Promise.all([
            odata(REFUELER_SVC + '/SalesOrders?$orderby=scheduled_date desc'),
            odata(ORDER_SVC + '/FuelOrders?$orderby=requested_date desc'),
            odata(ORDER_SVC + '/FuelDeliveries?$top=500'),
            odata(ORDER_SVC + '/FuelTickets?$top=500')
        ]);

        _fuelOrders = fuelOrders;
        _deliveries = deliveries;
        _tickets = tickets;

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
        var awaitingDelivery = fuelOrders.filter(function(o) {
            return o.status === 'Confirmed' || o.status === 'InProgress';
        }).length;
        var pendingSig = deliveries.filter(function(d) { return !d.signature_timestamp; }).length;
        var ticketsCreated = tickets.length;

        setText('kpiOrders', active);
        setText('kpiAwaitingDelivery', awaitingDelivery);
        setText('kpiTicketsPending', pendingSig);
        setText('kpiCompleted', ticketsCreated);

        // Delivery crew cards — fuel order centric
        renderDeliveryCards(fuelOrders, deliveries, tickets);

        // Sales orders table — with fuel order + delivery cross-refs
        renderSalesOrders(salesOrders, fuelOrders, deliveries, tickets);

        applyPersona(currentPersona);
    }

    // ═══ Delivery Cards (Delivery Crew view) ═══
    function renderDeliveryCards(fuelOrders, deliveries, tickets) {
        var grid = document.getElementById('deliveryGrid');
        if (!grid) return;

        var relevantOrders = fuelOrders.filter(function(o) {
            return ['Confirmed', 'InProgress', 'Delivered', 'Completed'].indexOf(o.status) >= 0;
        });

        if (relevantOrders.length === 0) {
            grid.innerHTML = '<div class="loading">No fuel orders assigned for delivery.</div>';
            return;
        }

        grid.innerHTML = relevantOrders.map(function(order) {
            var delivery = deliveries.find(function(d) { return d.order_ID === order.ID; });
            var ticket = delivery ? tickets.find(function(t) { return t.delivery_ID === delivery.ID; }) : null;

            var hasSigned = delivery && delivery.signature_timestamp;
            var hasTicket = !!ticket;
            var hasSapSO = order.s4_po_number;

            var cardClass = 'delivery-card';
            if (hasTicket) cardClass += ' delivery-card-complete';
            else if (hasSigned) cardClass += ' delivery-card-signed';
            else if (delivery) cardClass += ' delivery-card-inprogress';
            else cardClass += ' delivery-card-pending';

            var orderNum = order.order_number || '--';
            var station = order.station_code || '--';
            var qty = order.ordered_quantity || 0;
            var flight = getFlightFromOrder(order);

            var html = '<div class="' + cardClass + '">';

            // Header
            html += '<div class="delivery-card-header">' +
                '<div class="delivery-card-ref">' +
                    '<span class="delivery-order-num">' + fuelOrderLink(orderNum, order.ID) + '</span>' +
                    '<span class="delivery-flight">' + (flight ? flight + ' @ ' + station : station) + '</span>' +
                '</div>' +
                '<div>' + statusBadge(order.status) + '</div>' +
            '</div>';

            // Order info
            html += '<div class="delivery-card-order">' +
                '<div class="detail-row"><span class="detail-label">Ordered Qty</span><span class="detail-value">' + fmt(qty) + ' kg</span></div>' +
                '<div class="detail-row"><span class="detail-label">Requested</span><span class="detail-value">' + fmtDate(order.requested_date) + ' ' + fmtTime(order.requested_time) + '</span></div>' +
                '<div class="detail-row"><span class="detail-label">Priority</span><span class="detail-value">' + (order.priority || 'Normal') + '</span></div>' +
            '</div>';

            // ePOD section
            if (delivery) {
                var epodNum = delivery.delivery_number || delivery.epod_number || '--';
                html += '<div class="delivery-card-epod">' +
                    '<div class="epod-header">' +
                        '<span class="epod-title">ePOD: ' + epodNum + '</span>' +
                        statusBadge(delivery.status) +
                    '</div>' +
                    '<div class="detail-row"><span class="detail-label">Delivered</span><span class="detail-value detail-value-lg">' + fmt(delivery.delivered_quantity) + ' kg</span></div>' +
                    '<div class="detail-row"><span class="detail-label">Density</span><span class="detail-value">' + (delivery.density || '--') + ' kg/L</span></div>' +
                    '<div class="detail-row"><span class="detail-label">Temp</span><span class="detail-value">' + (delivery.temperature || '--') + ' °C</span></div>' +
                    '<div class="detail-row"><span class="detail-label">Vehicle</span><span class="detail-value">' + (delivery.vehicle_id || '--') + '</span></div>' +
                    '<div class="detail-row"><span class="detail-label">Driver</span><span class="detail-value">' + (delivery.driver_name || '--') + '</span></div>' +
                    '<div class="detail-row"><span class="detail-label">Pilot</span><span class="detail-value">' + (delivery.pilot_name || '--') + '</span></div>' +
                '</div>';

                // Signature status — disabled once ticket exists
                if (hasTicket) {
                    // Ticket created — show signed status, no actions
                    html += '<div class="delivery-card-sig delivery-card-sig-done">' +
                        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" fill="#107E3E"/></svg>' +
                        '<span>Pilot Signed — ' + new Date(delivery.signature_timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</span>' +
                        '<span class="sig-locked">Locked</span>' +
                    '</div>';
                } else if (hasSigned) {
                    html += '<div class="delivery-card-sig delivery-card-sig-done">' +
                        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" fill="#107E3E"/></svg>' +
                        '<span>Pilot Signed — ' + new Date(delivery.signature_timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</span>' +
                    '</div>';
                } else {
                    html += '<div class="delivery-card-sig delivery-card-sig-pending">' +
                        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" fill="#E9730C"/></svg>' +
                        '<span>Awaiting Pilot Signature</span>' +
                        '<button class="btn btn-primary btn-sign" data-order-id="' + order.ID + '" data-order-num="' + orderNum + '">Capture Signature</button>' +
                    '</div>';
                }

                // Photo upload — disabled once ticket exists
                if (!hasTicket) {
                    html += '<div class="delivery-card-photo">' +
                        '<input type="file" class="photo-input" accept="image/*" capture="environment" multiple style="display:none" data-order-id="' + order.ID + '">' +
                        '<button class="btn btn-secondary btn-photo" data-order-id="' + order.ID + '">' +
                            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3.2" fill="#107E3E"/><path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z" fill="#107E3E"/></svg>' +
                            ' Upload Photo' +
                        '</button>' +
                        '<div class="photo-thumbs" data-order-id="' + order.ID + '"></div>' +
                    '</div>';
                }

            } else {
                // No delivery yet — show "Capture ePOD" button
                html += '<div class="delivery-card-epod delivery-card-epod-empty">' +
                    '<div class="epod-empty-msg">No ePOD captured yet</div>' +
                    '<div class="epod-empty-hint">Record meter readings, temperature, density, then capture pilot signature.</div>' +
                    '<button class="btn btn-primary btn-capture-epod" data-order-id="' + order.ID + '" data-order-num="' + orderNum + '" data-flight="' + flight + '" data-station="' + station + '" data-qty="' + qty + '">' +
                        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm-2 14l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z" fill="#fff"/></svg>' +
                        ' Capture ePOD' +
                    '</button>' +
                '</div>';
            }

            // Document Flow: Ticket → SAP SO → Delivery+Invoice
            html += buildDocFlow(hasTicket, hasSigned, hasSapSO, order, ticket);

            html += '</div>'; // card
            return html;
        }).join('');
    }

    function buildDocFlow(hasTicket, hasSigned, hasSapSO, order, ticket) {
        var html = '<div class="delivery-card-docflow">';

        // Fuel Ticket
        if (hasTicket) {
            html += docflowStep('done', 'Fuel Ticket', ticket.ticket_number);
        } else if (hasSigned) {
            html += docflowStep('processing', 'Fuel Ticket', 'Auto-creating...');
        } else {
            html += docflowStep('waiting', 'Fuel Ticket', 'Awaiting signature');
        }
        html += '<div class="docflow-arrow">→</div>';

        // SAP SO
        if (hasSapSO) {
            html += docflowStep('done', 'SAP SO', order.s4_po_number);
        } else if (hasTicket) {
            html += docflowStep('processing', 'SAP SO', 'Auto-creating...');
        } else {
            html += docflowStep('waiting', 'SAP SO', 'Pending');
        }
        html += '<div class="docflow-arrow">→</div>';

        // Delivery + Invoice
        var isComplete = order.status === 'Completed' || order.status === 'Delivered';
        if (isComplete && hasSapSO) {
            html += docflowStep('done', 'Delivery + Invoice', 'Posted');
        } else if (hasSapSO) {
            html += docflowStep('processing', 'Delivery + Invoice', 'Auto-creating...');
        } else {
            html += docflowStep('waiting', 'Delivery + Invoice', 'Pending');
        }

        html += '</div>';
        return html;
    }

    function docflowStep(state, label, value) {
        var icons = {
            done: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="#107E3E"/></svg>',
            processing: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z" fill="#0070F2"/></svg>',
            waiting: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#C4C4C4" stroke-width="2"/></svg>'
        };
        return '<div class="docflow-step docflow-' + state + '">' +
            '<div class="docflow-icon">' + icons[state] + '</div>' +
            '<div class="docflow-label">' + label + '</div>' +
            '<div class="docflow-value' + (state === 'processing' ? ' docflow-auto' : '') + '">' + value + '</div>' +
        '</div>';
    }

    // ═══ Sales Orders Table (Supplier Planner view) ═══
    // Includes fuel order number + delivery link columns
    function renderSalesOrders(salesOrders, fuelOrders, deliveries, tickets) {
        var tbody = document.getElementById('salesOrdersBody');
        if (!tbody) return;

        if (salesOrders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="11" class="loading">No sales orders found.</td></tr>';
            return;
        }

        tbody.innerHTML = salesOrders.map(function(o) {
            var vehicleDriver = '';
            if (o.vehicle_id || o.driver_name) {
                vehicleDriver = (o.vehicle_id || '--') + '<br><span class="driver-name">' + (o.driver_name || '--') + '</span>';
            } else {
                vehicleDriver = '<span class="text-muted">Not assigned</span>';
            }

            // Find matching fuel order by customer_order_number or flight
            var fuelOrder = fuelOrders.find(function(fo) {
                return o.customer_order_number && fo.order_number === o.customer_order_number;
            });
            // Fallback: match by purchase_order_ID
            if (!fuelOrder) {
                fuelOrder = fuelOrders.find(function(fo) {
                    return fo.ID === o.purchase_order_ID;
                });
            }
            var foNum = fuelOrder ? fuelOrderLink(fuelOrder.order_number, fuelOrder.ID) : '--';

            // Find delivery for this fuel order
            var delivery = fuelOrder ? deliveries.find(function(d) { return d.order_ID === fuelOrder.ID; }) : null;
            var epodNum = delivery ? (delivery.delivery_number || delivery.epod_number) : null;
            var ticket = delivery ? tickets.find(function(t) { return t.delivery_ID === delivery.ID; }) : null;

            // Delivery status cell
            var deliveryCell = '';
            if (ticket) {
                deliveryCell = '<a class="link-epod" title="Fuel Ticket: ' + ticket.ticket_number + '">' + (epodNum || '--') + '</a>' +
                    '<br><span class="badge badge-posted" style="font-size:9px">TICKET: ' + ticket.ticket_number + '</span>';
            } else if (delivery) {
                deliveryCell = '<a class="link-epod">' + (epodNum || '--') + '</a>' +
                    '<br><span class="badge badge-pending" style="font-size:9px">' + (delivery.signature_timestamp ? 'SIGNED' : 'PENDING SIG') + '</span>';
            } else {
                deliveryCell = '<span class="text-muted">--</span>';
            }

            return '<tr class="so-row-' + (o.status || '').toLowerCase() + '">' +
                '<td><strong>' + (o.sales_order_number || '--') + '</strong></td>' +
                '<td>' + foNum + '</td>' +
                '<td>' + (o.customer_airline || '--') + '</td>' +
                '<td>' + (o.flight_number || '--') + '</td>' +
                '<td>' + (o.station_code || '--') + '</td>' +
                '<td class="qty-cell">' + fmt(o.estimated_quantity) + '</td>' +
                '<td class="qty-cell">' + (o.delivered_quantity ? fmt(o.delivered_quantity) : '<span class="text-muted">--</span>') + '</td>' +
                '<td>' + statusBadge(o.status) + '</td>' +
                '<td>' + deliveryCell + '</td>' +
                '<td>' + fmtDate(o.scheduled_date) + (o.scheduled_time ? '<br>' + fmtTime(o.scheduled_time) : '') + '</td>' +
                '<td>' + vehicleDriver + '</td>' +
                '</tr>';
        }).join('');
    }

    // ═══ Persona filtering ═══
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
        var deliverySection = document.getElementById('deliverySection');
        var uomSection = document.getElementById('uomSection');
        var salesOrderSection = document.getElementById('salesOrderSection');

        [pipelineSection, kpiSection, workflowSection, deliverySection, uomSection, salesOrderSection].forEach(function(el) {
            if (el) el.style.display = '';
        });

        if (persona === 'supplier') {
            // Supplier Planner: pipeline + KPIs + workflow + sales orders table + UoM
            // HIDE delivery cards (those are crew's job)
            if (deliverySection) deliverySection.style.display = 'none';
        } else if (persona === 'delivery') {
            // Delivery Crew: fuel order cards only
            if (pipelineSection) pipelineSection.style.display = 'none';
            if (kpiSection) kpiSection.style.display = 'none';
            if (workflowSection) workflowSection.style.display = 'none';
            if (uomSection) uomSection.style.display = 'none';
            if (salesOrderSection) salesOrderSection.style.display = 'none';
        }
    }

    // ═══ Actions: ePOD modal, Photo upload, Signature ═══
    function initActions() {
        document.addEventListener('click', function(e) {
            // Capture ePOD button → open Fiori modal
            var captureBtn = e.target.closest('.btn-capture-epod');
            if (captureBtn) {
                openEpodModal(captureBtn);
                return;
            }

            // Photo upload button (on card)
            var photoBtn = e.target.closest('.btn-photo');
            if (photoBtn) {
                var orderId = photoBtn.getAttribute('data-order-id');
                var input = document.querySelector('.photo-input[data-order-id="' + orderId + '"]');
                if (input) input.click();
                return;
            }

            // Signature capture button
            var signBtn = e.target.closest('.btn-sign');
            if (signBtn) {
                openEpodModalForSignature(signBtn);
                return;
            }
        });

        // Photo file change (card-level)
        document.addEventListener('change', function(e) {
            if (!e.target.classList.contains('photo-input')) return;
            var orderId = e.target.getAttribute('data-order-id');
            var thumbs = document.querySelector('.photo-thumbs[data-order-id="' + orderId + '"]');
            if (!thumbs || !e.target.files.length) return;
            addPhotoThumbs(e.target.files, thumbs);
        });
    }

    function addPhotoThumbs(files, container) {
        for (var i = 0; i < files.length; i++) {
            var file = files[i];
            if (!file.type.startsWith('image/')) continue;
            var reader = new FileReader();
            reader.onload = (function(f) {
                return function(ev) {
                    var img = document.createElement('img');
                    img.src = ev.target.result;
                    img.alt = f.name;
                    img.className = 'photo-thumb';
                    img.title = f.name + ' — ' + new Date().toLocaleTimeString();
                    container.appendChild(img);
                };
            })(file);
            reader.readAsDataURL(file);
        }
    }

    // ═══ ePOD Fiori Modal ═══
    function initEpodModal() {
        var modal = document.getElementById('epodModal');
        var closeBtn = document.getElementById('epodModalClose');
        var cancelBtn = document.getElementById('epodCancelBtn');
        var saveBtn = document.getElementById('epodSaveBtn');
        var photoBtn = document.getElementById('epodPhotoBtn');
        var photoInput = document.getElementById('epodPhotoInput');
        var meterStart = document.getElementById('epodMeterStart');
        var meterEnd = document.getElementById('epodMeterEnd');
        var density = document.getElementById('epodDensity');
        if (!modal) return;

        function closeModal() { modal.style.display = 'none'; }
        closeBtn.addEventListener('click', closeModal);
        cancelBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', function(e) { if (e.target === modal) closeModal(); });

        // Auto-calculate volume and kg when meter readings change
        function recalculate() {
            var start = parseFloat(meterStart.value) || 0;
            var end = parseFloat(meterEnd.value) || 0;
            var d = parseFloat(density.value) || 0;
            var volume = Math.max(0, end - start);
            var kg = Math.round(volume * d);
            document.getElementById('epodVolume').value = volume > 0 ? fmt(volume) + ' L' : '';
            document.getElementById('epodDeliveredKg').value = kg > 0 ? fmt(kg) + ' kg' : '';
        }
        meterStart.addEventListener('input', recalculate);
        meterEnd.addEventListener('input', recalculate);
        density.addEventListener('input', recalculate);

        // Photo in modal
        photoBtn.addEventListener('click', function() { photoInput.click(); });
        photoInput.addEventListener('change', function() {
            var thumbs = document.getElementById('epodPhotoThumbs');
            if (photoInput.files.length && thumbs) addPhotoThumbs(photoInput.files, thumbs);
        });

        // Save
        saveBtn.addEventListener('click', function() {
            var validation = validateEpodForm();
            var validationEl = document.getElementById('epodValidation');
            if (validation.length > 0) {
                validationEl.innerHTML = validation.map(function(m) { return '<div class="form-error-item">' + m + '</div>'; }).join('');
                validationEl.style.display = 'block';
                return;
            }
            validationEl.style.display = 'none';

            var orderId = document.getElementById('epodOrderId').value;
            var orderNum = document.getElementById('epodOrderNum').value;
            var start = parseFloat(meterStart.value);
            var end = parseFloat(meterEnd.value);
            var d = parseFloat(density.value);
            var volume = end - start;
            var kg = Math.round(volume * d);

            // Show success — in production this would POST to OData
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';

            setTimeout(function() {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="#fff"/></svg> Save ePOD';

                var validationEl2 = document.getElementById('epodValidation');
                validationEl2.innerHTML = '<div class="form-success-item">' +
                    '<strong>ePOD saved for ' + orderNum + '</strong><br>' +
                    'Delivered: ' + fmt(kg) + ' kg (' + fmt(volume) + ' L × ' + d + ' kg/L)<br>' +
                    'Vehicle: ' + document.getElementById('epodVehicle').value + '<br>' +
                    'Pilot: ' + document.getElementById('epodPilot').value + '<br><br>' +
                    'Next: Pilot signature on the delivery card → Fuel Ticket auto-created → SAP documents triggered.' +
                '</div>';
                validationEl2.style.display = 'block';

                setTimeout(function() { closeModal(); loadDashboard(); }, 3000);
            }, 800);
        });
    }

    function validateEpodForm() {
        var errors = [];
        var start = document.getElementById('epodMeterStart').value;
        var end = document.getElementById('epodMeterEnd').value;
        var temp = document.getElementById('epodTemp').value;
        var density = document.getElementById('epodDensity').value;
        var vehicle = document.getElementById('epodVehicle').value;
        var driver = document.getElementById('epodDriver').value;
        var pilot = document.getElementById('epodPilot').value;

        if (!start) errors.push('Meter Start is required.');
        if (!end) errors.push('Meter End is required.');
        if (start && end && parseFloat(end) <= parseFloat(start)) errors.push('Meter End must be greater than Meter Start.');
        if (!temp) errors.push('Temperature is required.');
        if (temp && (parseFloat(temp) < -40 || parseFloat(temp) > 50)) errors.push('Temperature must be between -40 and +50 °C.');
        if (!density) errors.push('Density is required.');
        if (density && (parseFloat(density) < 0.775 || parseFloat(density) > 0.840)) errors.push('Density must be between 0.775 and 0.840 kg/L.');
        if (!vehicle) errors.push('Vehicle ID is required.');
        if (!driver) errors.push('Driver Name is required.');
        if (!pilot) errors.push('Pilot Name is required.');
        return errors;
    }

    function openEpodModal(btn) {
        var modal = document.getElementById('epodModal');
        var orderNum = btn.getAttribute('data-order-num');
        var flight = btn.getAttribute('data-flight');
        var station = btn.getAttribute('data-station');
        var qty = btn.getAttribute('data-qty');
        var orderId = btn.getAttribute('data-order-id');

        // Populate read-only fields
        document.getElementById('epodModalSubtitle').textContent = flight + ' @ ' + station;
        document.getElementById('epodOrderId').value = orderId;
        document.getElementById('epodOrderNum').value = orderNum;
        document.getElementById('epodRefOrder').value = orderNum;
        document.getElementById('epodRefFlight').value = flight + ' @ ' + station;
        document.getElementById('epodRefQty').value = fmt(Number(qty)) + ' kg';

        // Clear form
        document.getElementById('epodMeterStart').value = '';
        document.getElementById('epodMeterEnd').value = '';
        document.getElementById('epodTemp').value = '';
        document.getElementById('epodDensity').value = '';
        document.getElementById('epodVolume').value = '';
        document.getElementById('epodDeliveredKg').value = '';
        document.getElementById('epodVehicle').value = '';
        document.getElementById('epodDriver').value = '';
        document.getElementById('epodPilot').value = '';
        document.getElementById('epodNotes').value = '';
        document.getElementById('epodPhotoThumbs').innerHTML = '';
        document.getElementById('epodValidation').style.display = 'none';

        modal.style.display = 'flex';
    }

    // Open modal pre-filled for signature capture (order already has delivery)
    function openEpodModalForSignature(btn) {
        var orderId = btn.getAttribute('data-order-id');
        var orderNum = btn.getAttribute('data-order-num');

        // Find delivery data
        var delivery = _deliveries.find(function(d) { return d.order_ID === orderId; });
        var order = _fuelOrders.find(function(o) { return o.ID === orderId; });
        if (!order) return;

        var flight = getFlightFromOrder(order);
        var station = order.station_code || '--';

        var modal = document.getElementById('epodModal');
        document.getElementById('epodModalSubtitle').textContent = flight + ' @ ' + station + ' — Signature';
        document.getElementById('epodOrderId').value = orderId;
        document.getElementById('epodOrderNum').value = orderNum;
        document.getElementById('epodRefOrder').value = orderNum;
        document.getElementById('epodRefFlight').value = flight + ' @ ' + station;
        document.getElementById('epodRefQty').value = fmt(order.ordered_quantity) + ' kg';

        // Pre-fill delivery data if available
        if (delivery) {
            var vol = delivery.delivered_quantity && delivery.density ? Math.round(delivery.delivered_quantity / delivery.density) : '';
            document.getElementById('epodMeterStart').value = '';
            document.getElementById('epodMeterEnd').value = '';
            document.getElementById('epodVolume').value = vol ? fmt(vol) + ' L' : '';
            document.getElementById('epodDeliveredKg').value = delivery.delivered_quantity ? fmt(delivery.delivered_quantity) + ' kg' : '';
            document.getElementById('epodTemp').value = delivery.temperature || '';
            document.getElementById('epodDensity').value = delivery.density || '';
            document.getElementById('epodVehicle').value = delivery.vehicle_id || '';
            document.getElementById('epodDriver').value = delivery.driver_name || '';
            document.getElementById('epodPilot').value = delivery.pilot_name || '';
        } else {
            document.getElementById('epodMeterStart').value = '';
            document.getElementById('epodMeterEnd').value = '';
            document.getElementById('epodTemp').value = '';
            document.getElementById('epodDensity').value = '';
            document.getElementById('epodVolume').value = '';
            document.getElementById('epodDeliveredKg').value = '';
            document.getElementById('epodVehicle').value = '';
            document.getElementById('epodDriver').value = '';
            document.getElementById('epodPilot').value = '';
        }
        document.getElementById('epodNotes').value = '';
        document.getElementById('epodPhotoThumbs').innerHTML = '';
        document.getElementById('epodValidation').style.display = 'none';

        modal.style.display = 'flex';
    }

    function init() {
        loadDashboard();
        initPersona();
        initActions();
        initEpodModal();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
