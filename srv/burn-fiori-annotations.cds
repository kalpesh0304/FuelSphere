/**
 * FuelSphere - Burn Service Fiori Annotations (FDD-08)
 *
 * Screens:
 * - FB_UI_002: Fuel Burn Register (List Report) — FuelBurnRegister TSX
 * - FB_UI_003: Fuel Burn Detail (Object Page) — FuelBurnDetail TSX
 * - POST-3: Burn Entry & ROB Input Form (Object Page Create) — BurnEntryForm TSX
 * - FUEL_BURN_EXCEPTION_001: Burn Exceptions (List Report + Object Page)
 * - POST-2: Flight Search & Selection (FuelOrders List Report)
 */

using BurnService as service from './burn-service';

// =============================================================================
// FUEL BURNS - List Report (FB_UI_002: Fuel Burn Register)
// Columns: Flight No, Tail No, Route, Date, ROB Dep, Uplift, ROB Arr, Burn, Var%, Source, Status, Doc
// =============================================================================

annotate service.FuelBurns with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: false }
    }
);

annotate service.FuelBurns with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Fuel Burn Record',
            TypeNamePlural : 'Fuel Burn Register',
            Title          : { Value: burn_record_number },
            Description    : { Value: tail_number },
            ImageUrl       : 'sap-icon://heating-cooling'
        },

        // Filters matching FuelBurnRegister TSX
        SelectionFields: [
            burn_record_number,
            tail_number,
            burn_date,
            data_source,
            status,
            variance_status
        ],

        // LineItem matching FuelBurnRegister table columns
        LineItem: [
            { Value: flight.flight_number, Label: 'Flight No', ![@UI.Importance]: #High },
            { Value: tail_number, Label: 'Tail No', ![@UI.Importance]: #High },
            { Value: origin_airport.iata_code, Label: 'Route', ![@UI.Importance]: #High },
            { Value: burn_date, Label: 'Date', ![@UI.Importance]: #High },
            { Value: rob_departure_kg, Label: 'ROB Dep (kg)', ![@UI.Importance]: #Medium },
            { Value: uplift_kg, Label: 'Uplift (kg)', ![@UI.Importance]: #Medium },
            { Value: rob_arrival_kg, Label: 'ROB Arr (kg)', ![@UI.Importance]: #Medium },
            { Value: actual_burn_kg, Label: 'Burn (kg)', ![@UI.Importance]: #High },
            { Value: variance_pct, Label: 'Var %', Criticality: varianceCriticality, ![@UI.Importance]: #High },
            { Value: data_source, Label: 'Source', ![@UI.Importance]: #Medium },
            { Value: status, Label: 'Status', Criticality: statusCriticality, ![@UI.Importance]: #High },
            { Value: posted_doc_number, Label: 'Doc', ![@UI.Importance]: #Low }
        ],

        PresentationVariant: {
            SortOrder: [{ Property: burn_date, Descending: true }],
            Visualizations: [ '@UI.LineItem' ]
        },

        // =================================================================
        // Object Page Header (FB_UI_003: Fuel Burn Detail)
        // Title: "Flight {flightNumber} | {tailNumber}"
        // =================================================================
        HeaderFacets: [
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.DataPoint#ROBDeparture',
                Label  : 'ROB Departure'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.DataPoint#UpliftQty',
                Label  : 'Uplift Qty'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.DataPoint#ROBArrival',
                Label  : 'ROB Arrival'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#BurnStatus',
                Label  : 'Status'
            }
        ],

        DataPoint#ROBDeparture: {
            Value: rob_departure_kg,
            Title: 'ROB Departure (kg)'
        },

        DataPoint#UpliftQty: {
            Value: uplift_kg,
            Title: 'Uplift Qty (kg)'
        },

        DataPoint#ROBArrival: {
            Value: rob_arrival_kg,
            Title: 'ROB Arrival (kg)'
        },

        FieldGroup#BurnStatus: {
            Data: [
                { Value: status, Label: 'Status' },
                { Value: reconciliation_status, Label: 'Reconciliation' },
                { Value: data_source, Label: 'Source' },
                { Value: posted_doc_number, Label: 'Posted Doc' }
            ]
        },

        // =================================================================
        // Object Page Sections (7 tabs: FuelBurnDetail + BurnEntryForm)
        // 1. Burn Data — ROB reconciliation with formula
        // 2. Data Source & Justification — Manual entry reason (POST-3)
        // 3. Reconciliation Preview — Burn variance & approval routing (POST-3)
        // 4. Variance Analysis — Gauge visualization + comparisons
        // 5. Timeline — Submitted → Validated → Approved → Posted → Archived
        // 6. Documents — ePOD, Fuel Ticket, S/4 Doc, ACARS Message
        // 7. Audit Trail — Timestamp, User, Action, Details
        // =================================================================
        Facets: [
            // Section 1: Burn Data (Reconciliation)
            {
                $Type  : 'UI.CollectionFacet',
                ID     : 'BurnData',
                Label  : 'Burn Data',
                Facets : [
                    {
                        $Type  : 'UI.ReferenceFacet',
                        ID     : 'ROBReconciliation',
                        Label  : 'ROB Reconciliation',
                        Target : '@UI.FieldGroup#ROBReconciliation'
                    },
                    {
                        $Type  : 'UI.ReferenceFacet',
                        ID     : 'BurnFormula',
                        Label  : 'Reconciliation Formula',
                        Target : '@UI.FieldGroup#BurnFormula'
                    },
                    {
                        $Type  : 'UI.ReferenceFacet',
                        ID     : 'FlightInfo',
                        Label  : 'Flight Information',
                        Target : '@UI.FieldGroup#FlightInfo'
                    }
                ]
            },
            // Section 2: Data Source & Justification (from BurnEntryForm POST-3)
            {
                $Type  : 'UI.CollectionFacet',
                ID     : 'DataSourceJustification',
                Label  : 'Data Source & Justification',
                Facets : [
                    {
                        $Type  : 'UI.ReferenceFacet',
                        ID     : 'DataSourceInfo',
                        Label  : 'Data Source',
                        Target : '@UI.FieldGroup#DataSourceInfo'
                    },
                    {
                        $Type  : 'UI.ReferenceFacet',
                        ID     : 'JustificationInfo',
                        Label  : 'Justification',
                        Target : '@UI.FieldGroup#JustificationInfo'
                    }
                ]
            },
            // Section 3: Reconciliation Preview (from BurnEntryForm POST-3)
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'ReconciliationPreview',
                Label  : 'Reconciliation',
                Target : '@UI.FieldGroup#ReconciliationPreview'
            },
            // Section 4: Variance Analysis
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'VarianceAnalysis',
                Label  : 'Variance Analysis',
                Target : '@UI.FieldGroup#VarianceAnalysis'
            },
            // Section 5: Timeline (Process milestones)
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Timeline',
                Label  : 'Timeline',
                Target : '@UI.FieldGroup#BurnTimeline'
            },
            // Section 6: Documents
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Documents',
                Label  : 'Documents',
                Target : '@UI.FieldGroup#BurnDocuments'
            },
            // Section 7: Audit Trail
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'AuditTrail',
                Label  : 'Audit Trail',
                Target : '@UI.FieldGroup#BurnAudit'
            }
        ],

        // -- Burn Data FieldGroups --

        FieldGroup#ROBReconciliation: {
            Label: 'ROB Reconciliation',
            Data: [
                { Value: rob_departure_kg, Label: 'ROB Departure (kg)' },
                { Value: uplift_kg, Label: 'Uplift Qty (kg)' },
                { Value: rob_arrival_kg, Label: 'ROB Arrival (kg)' }
            ]
        },

        FieldGroup#BurnFormula: {
            Label: 'Reconciliation Formula: Burn = (ROB Departure + Uplift) - ROB Arrival',
            Data: [
                { Value: reported_burn_kg, Label: 'Reported Burn (kg)' },
                { Value: reconciled_burn_kg, Label: 'Reconciled Burn (kg)' },
                { Value: variance_pct, Label: 'Variance %' }
            ]
        },

        FieldGroup#FlightInfo: {
            Label: 'Flight Information',
            Data: [
                { Value: tail_number, Label: 'Tail Number' },
                { Value: aircraft.aircraft_model, Label: 'Aircraft Model' },
                { Value: origin_airport.iata_code, Label: 'Origin' },
                { Value: destination_airport.iata_code, Label: 'Destination' },
                { Value: block_off_time, Label: 'Block Off' },
                { Value: block_on_time, Label: 'Block On' },
                { Value: flight_duration_mins, Label: 'Duration (min)' }
            ]
        },

        // -- Data Source & Justification FieldGroups (BurnEntryForm POST-3) --

        FieldGroup#DataSourceInfo: {
            Label: 'Data Source',
            Data: [
                { Value: data_source, Label: 'Data Source' },
                { Value: source_message_id, Label: 'Source Message ID' }
            ]
        },

        FieldGroup#JustificationInfo: {
            Label: 'Justification for Manual Entry',
            Data: [
                { Value: justification, Label: 'Justification' }
            ]
        },

        // -- Reconciliation Preview FieldGroup (BurnEntryForm POST-3) --
        // Formula: Burn = ROB Departure - ROB Arrival
        // Thresholds: ≤2% Auto-Approved, 2-5% Supervisor, >5% Finance Controller

        FieldGroup#ReconciliationPreview: {
            Label: 'Reconciliation',
            Data: [
                { Value: reported_burn_kg, Label: 'Reported Burn (kg)' },
                { Value: reconciled_burn_kg, Label: 'Reconciled Burn (kg)' },
                { Value: variance_kg, Label: 'Variance (kg)' },
                { Value: variance_pct, Label: 'Variance %', Criticality: varianceCriticality },
                { Value: reconciliation_status, Label: 'Approval Routing', Criticality: reconciliationCriticality }
            ]
        },

        // -- Variance Analysis FieldGroup --

        FieldGroup#VarianceAnalysis: {
            Label: 'Variance Analysis',
            Data: [
                { Value: variance_kg, Label: 'Variance (kg)' },
                { Value: variance_pct, Label: 'Variance %' },
                { Value: variance_status, Label: 'Variance Status' },
                { Value: planned_burn_kg, Label: 'Planned Burn (kg)' },
                { Value: actual_burn_kg, Label: 'Actual Burn (kg)' },
                { Value: requires_review, Label: 'Requires Review' },
                { Value: review_notes, Label: 'Review Notes' },
                { Value: reviewed_by, Label: 'Reviewed By' },
                { Value: reviewed_at, Label: 'Reviewed At' }
            ]
        },

        // -- Timeline FieldGroup --

        FieldGroup#BurnTimeline: {
            Label: 'Process Timeline',
            Data: [
                { Value: burn_date, Label: 'Data Received' },
                { Value: submitted_by, Label: 'Submitted By' },
                { Value: submitted_at, Label: 'Submitted At' },
                { Value: confirmed_at, Label: 'Validated At' },
                { Value: confirmed_by, Label: 'Validated By' },
                { Value: finance_post_date, Label: 'Posted At' },
                { Value: posted_doc_number, Label: 'Posted Document' }
            ]
        },

        // -- Documents FieldGroup --

        FieldGroup#BurnDocuments: {
            Label: 'Related Documents',
            Data: [
                { Value: source_message_id, Label: 'ACARS/EFB Message ID' },
                { Value: posted_doc_number, Label: 'S/4 Posting Document' },
                { Value: data_source, Label: 'Data Source' }
            ]
        },

        // -- Audit Trail FieldGroup --

        FieldGroup#BurnAudit: {
            Label: 'Audit Trail',
            Data: [
                { Value: created_at, Label: 'Created At' },
                { Value: created_by, Label: 'Created By' },
                { Value: modified_at, Label: 'Modified At' },
                { Value: modified_by, Label: 'Modified By' },
                { Value: status, Label: 'Current Status' },
                { Value: finance_posted, Label: 'Posted to Finance' }
            ]
        }
    }
);

// Field-level annotations for FuelBurns
annotate service.FuelBurns with {
    burn_record_number  @title: 'Record ID';
    tail_number         @title: 'Tail Number';
    burn_date           @title: 'Burn Date';
    burn_time           @title: 'Burn Time';
    rob_departure_kg    @title: 'ROB Departure (kg)' @Measures.Unit: 'kg';
    uplift_kg           @title: 'Uplift (kg)' @Measures.Unit: 'kg';
    rob_arrival_kg      @title: 'ROB Arrival (kg)' @Measures.Unit: 'kg';
    reported_burn_kg    @title: 'Reported Burn (kg)' @Measures.Unit: 'kg';
    reconciled_burn_kg  @title: 'Reconciled Burn (kg)' @Measures.Unit: 'kg';
    actual_burn_kg      @title: 'Actual Burn (kg)' @Measures.Unit: 'kg';
    planned_burn_kg     @title: 'Planned Burn (kg)' @Measures.Unit: 'kg';
    variance_kg         @title: 'Variance (kg)' @Measures.Unit: 'kg';
    variance_pct        @title: 'Variance %';
    variance_status     @title: 'Variance Status';
    data_source         @title: 'Data Source';
    status              @title: 'Status';
    requires_review        @title: 'Requires Review';
    posted_doc_number      @title: 'Posted Document';
    justification          @title: 'Justification' @UI.MultiLineText;
    reconciliation_status  @title: 'Reconciliation Status';
    submitted_by           @title: 'Submitted By';
    submitted_at           @title: 'Submitted At';
};

// =============================================================================
// FUEL BURN EXCEPTIONS - List Report + Object Page
// =============================================================================

annotate service.FuelBurnExceptions with @(
    Capabilities: {
        InsertRestrictions: { Insertable: true },
        UpdateRestrictions: { Updatable: true },
        DeleteRestrictions: { Deletable: false }
    }
);

annotate service.FuelBurnExceptions with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Burn Exception',
            TypeNamePlural : 'Burn Exceptions',
            Title          : { Value: tail_number },
            Description    : { Value: exception_date },
            ImageUrl       : 'sap-icon://warning2'
        },

        SelectionFields: [
            tail_number,
            exception_date,
            exception_type,
            severity,
            status
        ],

        LineItem: [
            { Value: tail_number, Label: 'Tail Number', ![@UI.Importance]: #High },
            { Value: exception_date, Label: 'Date', ![@UI.Importance]: #High },
            { Value: exception_type, Label: 'Exception Type', ![@UI.Importance]: #High },
            { Value: severity, Label: 'Severity', ![@UI.Importance]: #High },
            { Value: variance_amount_kg, Label: 'Variance (kg)', ![@UI.Importance]: #Medium },
            { Value: variance_percentage, Label: 'Variance %', ![@UI.Importance]: #Medium },
            { Value: assigned_to, Label: 'Assigned To', ![@UI.Importance]: #Medium },
            { Value: status, Label: 'Status', ![@UI.Importance]: #High }
        ],

        PresentationVariant: {
            SortOrder: [{ Property: exception_date, Descending: true }],
            Visualizations: [ '@UI.LineItem' ]
        },

        // Object Page Sections (3)
        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'ExceptionDetails',
                Label  : 'Exception Details',
                Target : '@UI.FieldGroup#ExceptionDetails'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Investigation',
                Label  : 'Investigation',
                Target : '@UI.FieldGroup#Investigation'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                ID     : 'Resolution',
                Label  : 'Resolution',
                Target : '@UI.FieldGroup#Resolution'
            }
        ],

        FieldGroup#ExceptionDetails: {
            Label: 'Exception Details',
            Data: [
                { Value: tail_number, Label: 'Tail Number' },
                { Value: exception_date, Label: 'Exception Date' },
                { Value: exception_type, Label: 'Exception Type' },
                { Value: severity, Label: 'Severity' },
                { Value: variance_amount_kg, Label: 'Variance Amount (kg)' },
                { Value: variance_percentage, Label: 'Variance Percentage' },
                { Value: status, Label: 'Status' }
            ]
        },

        FieldGroup#Investigation: {
            Label: 'Investigation',
            Data: [
                { Value: assigned_to, Label: 'Assigned To' },
                { Value: root_cause, Label: 'Root Cause' },
                { Value: investigation_notes, Label: 'Investigation Notes' }
            ]
        },

        FieldGroup#Resolution: {
            Label: 'Resolution',
            Data: [
                { Value: corrective_action, Label: 'Corrective Action' },
                { Value: resolved_by, Label: 'Resolved By' },
                { Value: resolved_at, Label: 'Resolved At' }
            ]
        }
    }
);

annotate service.FuelBurnExceptions with {
    tail_number         @title: 'Tail Number';
    exception_date      @title: 'Exception Date';
    exception_type      @title: 'Exception Type';
    severity            @title: 'Severity';
    variance_amount_kg  @title: 'Variance (kg)';
    variance_percentage @title: 'Variance %';
    status              @title: 'Status';
    assigned_to         @title: 'Assigned To';
    investigation_notes @title: 'Investigation Notes';
};

// =============================================================================
// FUEL ORDERS (Burn Module View) - Flight Search & Selection (POST-2)
// List Report: "All Fuel Uplift and ROB Records"
// Shows fuel orders from post-delivery/burn operations perspective
// =============================================================================

annotate service.FuelOrders with @(
    Capabilities: {
        InsertRestrictions: { Insertable: false },
        UpdateRestrictions: { Updatable: false },
        DeleteRestrictions: { Deletable: false }
    }
);

annotate service.FuelOrders with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Fuel Uplift Record',
            TypeNamePlural : 'All Fuel Uplift and ROB Records',
            Title          : { Value: order_number },
            Description    : { Value: station_code }
        },

        SelectionFields: [
            order_number,
            station_code,
            status,
            supplier_ID,
            requested_date
        ],

        LineItem: [
            { Value: order_number, Label: 'Fuel Order ID', ![@UI.Importance]: #High },
            { Value: flight.flight_number, Label: 'Flight', ![@UI.Importance]: #High },
            { Value: requested_date, Label: 'Date', ![@UI.Importance]: #High },
            { Value: station_code, Label: 'Station', ![@UI.Importance]: #High },
            { Value: status, Label: 'Status', ![@UI.Importance]: #High },
            { Value: supplier.supplier_name, Label: 'Supplier', ![@UI.Importance]: #Medium },
            { Value: ordered_quantity, Label: 'Uplifted Qty (kg)', ![@UI.Importance]: #High }
        ],

        PresentationVariant: {
            SortOrder: [{ Property: requested_date, Descending: true }],
            Visualizations: [ '@UI.LineItem' ]
        }
    }
);

annotate service.FuelOrders with {
    order_number      @title: 'Fuel Order ID';
    station_code      @title: 'Station';
    status            @title: 'Status';
    requested_date    @title: 'Date';
    ordered_quantity  @title: 'Uplifted Qty (kg)';
};
