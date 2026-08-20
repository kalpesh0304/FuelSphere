/**
 * FuelSphere - Aircraft Register Fiori Annotations (WP-UI-01)
 *
 * MasterDataService.AircraftRegistrations had no annotation of any kind: no
 * LineItem, no Facets, no HeaderInfo. It is the aircraft register WP-07 added
 * (defect D11) and the only place an individual tail exists as a record
 * rather than as a free-text string.
 *
 * Kept in its own file rather than appended to fiori-annotations.cds, which
 * holds the rest of MasterDataService. The alternative — one more block at the
 * end of a 56 KB file — is the operation the WP-07 annotation-rebinding trap
 * punished, and a single-purpose file cannot reassign an annotation that is
 * not in it. Named to the existing <area>-fiori-annotations.cds pattern.
 */

using MasterDataService as service from './master-data-service';

// =============================================================================
// AIRCRAFT REGISTRATIONS - List Report + Object Page
// =============================================================================

annotate MasterDataService.AircraftRegistrations with @(
    UI: {
        HeaderInfo: {
            TypeName       : 'Aircraft Registration',
            TypeNamePlural : 'Aircraft Register',
            Title          : { Value: registration },
            Description    : { Value: aircraft_type_code }
        },

        // A register is searched by tail, so the tail is the first column and
        // the filter bar leads with it.
        SelectionFields: [
            registration,
            aircraft_type_code,
            record_status,
            operator_code,
            on_own_aoc
        ],

        LineItem: [
            { Value: registration, Label: 'Registration', ![@UI.Importance]: #High },
            { Value: aircraft_type_code, Label: 'Type', ![@UI.Importance]: #High },
            // WP-07 / decision A4. PROVISIONAL is not an error: a tail can be
            // recorded before its paperwork completes, and fuel is ordered
            // against it. It is the state with a deadline attached, so it
            // reads critical and CONFIRMED reads positive.
            {
                Value: record_status,
                Label: 'Record Status',
                Criticality: { $edmJson: { $If: [
                    { $Eq: [{ $Path: 'record_status' }, 'CONFIRMED'] }, 3,
                    { $If: [ { $Eq: [{ $Path: 'record_status' }, 'PROVISIONAL'] }, 2, 1 ] } ] } },
                ![@UI.Importance]: #High
            },
            // Only meaningful while PROVISIONAL, and the reason the status is
            // not simply a flag.
            { Value: provisional_expiry, Label: 'Provisional Until', ![@UI.Importance]: #High },
            { Value: fuel_capacity_kg, Label: 'Fuel Capacity (kg)', ![@UI.Importance]: #Medium },
            { Value: dry_operating_weight_kg, Label: 'Dry Operating Weight (kg)', ![@UI.Importance]: #Low },
            { Value: operator_code, Label: 'Operator', ![@UI.Importance]: #Medium },
            { Value: on_own_aoc, Label: 'Own AOC', ![@UI.Importance]: #Medium },
            { Value: apu_burn_rate_kg_hr, Label: 'APU Burn (kg/hr)', ![@UI.Importance]: #Low },
            { Value: performance_factor_pct, Label: 'Performance Factor (%)', ![@UI.Importance]: #Low }
        ],

        Facets: [
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#Identity',
                Label  : 'Identity'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#Performance',
                Label  : 'Performance'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#Operator',
                Label  : 'Operator and Cost Object'
            },
            {
                $Type  : 'UI.ReferenceFacet',
                Target : '@UI.FieldGroup#RegistrationStatus',
                Label  : 'Registration Status'
            }
        ],

        FieldGroup#Identity: {
            Label: 'Identity',
            Data: [
                { Value: registration, Label: 'Registration' },
                { Value: aircraft_type_code, Label: 'Aircraft Type' },
                { Value: dry_operating_weight_kg, Label: 'Dry Operating Weight (kg)' },
                { Value: fuel_capacity_kg, Label: 'Fuel Capacity (kg)' }
            ]
        },

        FieldGroup#Performance: {
            Label: 'Performance',
            Data: [
                // Per tail, not per type. Two airframes of one type differ,
                // which is the reason this register exists.
                { Value: performance_factor_pct, Label: 'Performance Factor (%)' },
                // Burned on the ground and never metered. Nothing consumes
                // this until WP-19; it is shown so the value can be
                // maintained before then.
                { Value: apu_burn_rate_kg_hr, Label: 'APU Burn Rate (kg/hr)' }
            ]
        },

        FieldGroup#Operator: {
            Label: 'Operator and Cost Object',
            Data: [
                { Value: operator_code, Label: 'Operator' },
                { Value: on_own_aoc, Label: 'On Own AOC' },
                { Value: cost_object_type, Label: 'Cost Object Type' },
                { Value: cost_object_id, Label: 'Cost Object' }
            ]
        },

        FieldGroup#RegistrationStatus: {
            Label: 'Registration Status',
            Data: [
                {
                    Value: record_status,
                    Label: 'Record Status',
                    Criticality: { $edmJson: { $If: [
                        { $Eq: [{ $Path: 'record_status' }, 'CONFIRMED'] }, 3,
                        { $If: [ { $Eq: [{ $Path: 'record_status' }, 'PROVISIONAL'] }, 2, 1 ] } ] } }
                },
                // The expiry sits beside the status for the same reason a
                // variance sits beside its tolerance: PROVISIONAL alone says
                // nothing about how long it has been so.
                { Value: provisional_expiry, Label: 'Provisional Until' },
                { Value: confirmed_by, Label: 'Confirmed By' },
                { Value: confirmed_at, Label: 'Confirmed At' },
                { Value: is_active, Label: 'Active' }
            ]
        }
    }
);

// -----------------------------------------------------------------------------
// Field-level annotations
// -----------------------------------------------------------------------------

annotate MasterDataService.AircraftRegistrations with {
    ID                      @UI.Hidden;
    // Internal carrier for a Criticality reference, and dead besides: the
    // after-READ that populates activeCriticality is registered for the other
    // master-data entities and not for this one. Hidden rather than labelled.
    activeCriticality       @UI.Hidden;

    // WP-UI-02: @title only. WP-UI-01 set @title and @Common.Label together
    // on several of these, and @Common.Label wins in the EDMX — so the
    // @title was dead text and the screen showed the other wording.
    registration            @title: 'Registration';
    aircraft_type_code      @title: 'Aircraft Type';
    record_status           @title: 'Record Status';
    provisional_expiry      @title: 'Provisional Expiry';
    dry_operating_weight_kg @title: 'Dry Operating Weight (kg)';
    fuel_capacity_kg        @title: 'Fuel Capacity (kg)';
    apu_burn_rate_kg_hr     @title: 'APU Burn Rate (kg/h)';
    performance_factor_pct  @title: 'Performance Factor (%)';
    on_own_aoc              @title: 'On Own AOC';
    cost_object_type        @title: 'Cost Object Type';
    cost_object_id          @title: 'Cost Object';

    operator_code           @title: 'Operator';
    is_active               @title: 'Active';
    aircraft_type           @title: 'Aircraft Type';

    // Set by the confirm path, not typed.
    confirmed_by            @title: 'Confirmed By' @Common.FieldControl: #ReadOnly;
    confirmed_at            @title: 'Confirmed At' @Common.FieldControl: #ReadOnly;

    created_at              @title: 'Created At';
    created_by              @title: 'Created By';
    modified_at             @title: 'Changed At';
    modified_by             @title: 'Changed By';
};
