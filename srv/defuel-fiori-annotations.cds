using DefuelService from './defuel-service';

/**
 * Defueling — recording a defuel and settling it.
 *
 * FOUR VIEWS ON ONE LIST, and they are four different jobs rather than four
 * filters on one. Recording is a station user minutes after pushback;
 * working the parked items is a controller chasing a vendor; the open
 * credits are money the airline is owed and has not received. A single list
 * would serve the first and bury the other two.
 *
 * DISTINCT QUALIFIER PER VIEW. Fiori Elements keys a multi-view list report
 * by annotation path, so reusing one qualifier across views collides and it
 * renders no table at all — paid for once already on the configuration tile.
 *
 * ANNOTATIONS LIVE HERE, NOT IN THE APP. The app's annotation.xml is an
 * empty stub and everything it renders comes from CAP through $metadata.
 * Changing this file means deploying the BACKEND; deploying the app changes
 * nothing. Also paid for, three times.
 */
annotate DefuelService.Defuels with @(

    UI: {
        // FILTER ON reason_text, NOT reason_code. The code is the
        // association's generated foreign key, which cannot carry a @title —
        // so it renders in the filter bar as the literal "reason_code", the
        // database's word in front of somebody who does not read the
        // database. The description filters just as well and reads.
        SelectionFields: [
            tail_number, carrier_code, location_code, movement_type,
            status, reason_text, event_utc
        ],

        // ---- the columns, in the order the question gets asked ------------
        LineItem: [
            { Value: defuel_number,  Label: 'Defuel',    ![@UI.Importance]: #High },
            { Value: event_local,    Label: 'When (local)', ![@UI.Importance]: #High },
            { Value: tail_number,    Label: 'Tail',      ![@UI.Importance]: #High },
            { Value: flight_number,  Label: 'Flight' },
            { Value: movement_type,  Label: 'Movement',  ![@UI.Importance]: #High },
            { Value: reason_text,    Label: 'Reason' },
            { Value: location_code,  Label: 'Location',  ![@UI.Importance]: #High },
            { Value: quantity_kg,    Label: 'Quantity (kg)', ![@UI.Importance]: #High },

            // THE BASIS ON THE ROW (R3.6). With a carrier default, a carrier
            // override and a specific-identification override all in play, a
            // value without its basis cannot be reconciled to anything.
            { Value: valuation_basis, Label: 'Basis',    ![@UI.Importance]: #High },
            { Value: held_value_usd, Label: 'Held value', ![@UI.Importance]: #High },

            // WHAT IS STILL OWED. The figure a controller is actually
            // working, and the reason the open-credits view exists.
            { Value: open_value_usd, Label: 'Still open', ![@UI.Importance]: #High },
            { Value: credited_usd,   Label: 'Credited' },
            { Value: written_off_usd, Label: 'Written off' },

            { Value: status, Label: 'Status',
              Criticality: statusCriticality, ![@UI.Importance]: #High },

            { Value: vendor_name,    Label: 'Vendor',    ![@UI.Importance]: #Low },
            { Value: carrier_code,   Label: 'Carrier',   ![@UI.Importance]: #Low },
            { Value: event_zone,     Label: 'Zone',      ![@UI.Importance]: #Low },

            // ---- the actions, on the row -----------------------------------
            { $Type: 'UI.DataFieldForAction', Label: 'Settle',
              Action: 'DefuelService.EntityContainer/Defuels_settle',
              ![@UI.Importance]: #High },
            { $Type: 'UI.DataFieldForAction', Label: 'Write off',
              Action: 'DefuelService.EntityContainer/Defuels_writeOff' },
            { $Type: 'UI.DataFieldForAction', Label: 'Reverse',
              Action: 'DefuelService.EntityContainer/Defuels_reverse' }
        ],

        // =================== THE FOUR VIEWS ================================

        /** Everything, newest first. Where a station user lands. */
        SelectionPresentationVariant #All: {
            $Type: 'UI.SelectionPresentationVariantType',
            Text: 'All defuels',
            SelectionVariant: { $Type: 'UI.SelectionVariantType', SelectOptions: [] },
            PresentationVariant: {
                $Type: 'UI.PresentationVariantType',
                SortOrder: [{ $Type: 'Common.SortOrderType',
                              Property: event_utc, Descending: true }],
                Visualizations: ['@UI.LineItem']
            }
        },

        /**
         * Parked — recorded, nothing posted, outcome unknown (R5.9).
         *
         * THIS IS THE WORKLIST, and it is also the month-end population: your
         * Q4 answer settled that only parked items accrue, because once
         * posted the Expected Credit account carries the receivable. A parked
         * item is worked or written off; nothing else happens to it.
         */
        SelectionPresentationVariant #Parked: {
            $Type: 'UI.SelectionPresentationVariantType',
            Text: 'Parked',
            SelectionVariant: {
                $Type: 'UI.SelectionVariantType',
                SelectOptions: [{
                    $Type: 'UI.SelectOptionType',
                    PropertyName: status,
                    Ranges: [{ $Type: 'UI.SelectionRangeType',
                               Sign: #I, Option: #EQ, Low: 'PARKED' }]
                }]
            },
            PresentationVariant: {
                $Type: 'UI.PresentationVariantType',
                SortOrder: [{ $Type: 'Common.SortOrderType',
                              Property: event_utc, Descending: false }],
                Visualizations: ['@UI.LineItem']
            }
        },

        /**
         * Open credits — money owed and not received (R10.15).
         *
         * THE VIEW THAT PAYS FOR THE FEATURE. Everything else records what
         * happened; this shows what the airline is owed. Oldest first,
         * deliberately: an expected credit nobody chases is a write-off
         * waiting to be discovered, so the stalest item is the one that
         * should be at the top.
         */
        SelectionPresentationVariant #OpenCredits: {
            $Type: 'UI.SelectionPresentationVariantType',
            Text: 'Open credits',
            SelectionVariant: {
                $Type: 'UI.SelectionVariantType',
                SelectOptions: [{
                    $Type: 'UI.SelectOptionType',
                    PropertyName: status,
                    Ranges: [
                        { $Type: 'UI.SelectionRangeType', Sign: #I, Option: #EQ, Low: 'PARKED' },
                        { $Type: 'UI.SelectionRangeType', Sign: #I, Option: #EQ, Low: 'POSTED' }
                    ]
                }]
            },
            PresentationVariant: {
                $Type: 'UI.PresentationVariantType',
                SortOrder: [{ $Type: 'Common.SortOrderType',
                              Property: event_utc, Descending: false }],
                Visualizations: ['@UI.LineItem']
            }
        },

        /** Closed — settled, written off or reversed. The audit view. */
        SelectionPresentationVariant #Closed: {
            $Type: 'UI.SelectionPresentationVariantType',
            Text: 'Closed',
            SelectionVariant: {
                $Type: 'UI.SelectionVariantType',
                SelectOptions: [{
                    $Type: 'UI.SelectOptionType',
                    PropertyName: status,
                    Ranges: [
                        { $Type: 'UI.SelectionRangeType', Sign: #I, Option: #EQ, Low: 'SETTLED' },
                        { $Type: 'UI.SelectionRangeType', Sign: #I, Option: #EQ, Low: 'WRITTEN_OFF' },
                        { $Type: 'UI.SelectionRangeType', Sign: #I, Option: #EQ, Low: 'REVERSED' }
                    ]
                }]
            },
            PresentationVariant: {
                $Type: 'UI.PresentationVariantType',
                SortOrder: [{ $Type: 'Common.SortOrderType',
                              Property: event_utc, Descending: true }],
                Visualizations: ['@UI.LineItem']
            }
        },

        // ======================= THE OBJECT PAGE ===========================

        HeaderInfo: {
            TypeName       : 'Defuel',
            TypeNamePlural : 'Defuels',
            Title          : { Value: defuel_number },
            Description    : { Value: tail_number }
        },

        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'What',
              Target: '@UI.FieldGroup#What', Label: 'What happened' },
            { $Type: 'UI.ReferenceFacet', ID: 'Value',
              Target: '@UI.FieldGroup#Value', Label: 'Value and settlement' },
            { $Type: 'UI.ReferenceFacet', ID: 'Ledger',
              Target: 'ledger_entries/@UI.LineItem', Label: 'Location ledger' },
            { $Type: 'UI.ReferenceFacet', ID: 'Settlements',
              Target: 'settlements/@UI.LineItem', Label: 'Settlements' }
        ],

        FieldGroup #What: {
            Data: [
                { Value: defuel_number,  Label: 'Defuel number' },
                { Value: movement_type,  Label: 'Movement' },
                { Value: tail_number,    Label: 'Tail' },
                { Value: carrier_code,   Label: 'Carrier' },
                { Value: flight_number,  Label: 'Flight' },
                { Value: reason_text,    Label: 'Reason' },
                { Value: location_code,  Label: 'Destination location' },
                { Value: quantity_kg,    Label: 'Quantity (kg)' },
                { Value: quantity_l,     Label: 'Quantity (L)' },
                { Value: density,        Label: 'Density' },
                { Value: density_source, Label: 'Density from' },
                // ALL THREE PARTS OF THE TIME, because each does a different
                // job: the local is what the ticket says, the UTC is what the
                // ledger sorts on, and the zone is what connects them.
                { Value: event_local,    Label: 'Time (local)' },
                { Value: event_zone,     Label: 'Station zone' },
                { Value: event_utc,      Label: 'Time (UTC)' },
                { Value: event_dst_fold, Label: 'Second reading of a repeated hour' },
                { Value: vendor_name,    Label: 'Vendor' },
                { Value: notes,          Label: 'Notes' }
            ]
        },

        FieldGroup #Value: {
            Data: [
                { Value: valuation_basis,   Label: 'Valuation basis' },
                { Value: fuel_value_usd,    Label: 'Fuel value' },
                { Value: defuel_fee_usd,    Label: 'Defuel fee' },
                { Value: fee_treatment,     Label: 'Fee treatment' },
                { Value: held_value_usd,    Label: 'Held value' },
                { Value: settled_qty_kg,    Label: 'Settled (kg)' },
                { Value: credited_usd,      Label: 'Credited by vendor' },
                { Value: written_off_usd,   Label: 'Written off' },
                { Value: open_value_usd,    Label: 'Still open' },
                { Value: status,            Label: 'Status', Criticality: statusCriticality },
                { Value: is_reversed,       Label: 'Reversed' },
                // The five components Q8 named. Airport/royalty is held at
                // zero per Q1 Option C until a source for it exists — a zero
                // that is visibly zero is defensible; a figure split out by
                // guesswork is not.
                { Value: component_base_usd,        Label: 'Baseline cost' },
                { Value: component_service_fee_usd, Label: 'Fuel services fee' },
                { Value: component_airport_fee_usd, Label: 'Airport / royalty fee' },
                { Value: component_into_plane_usd,  Label: 'Into-plane' },
                { Value: component_tax_usd,         Label: 'Taxes' }
            ]
        },

        Identification: [
            { $Type: 'UI.DataFieldForAction', Label: 'Settle',
              Action: 'DefuelService.EntityContainer/Defuels_settle' },
            { $Type: 'UI.DataFieldForAction', Label: 'Write off',
              Action: 'DefuelService.EntityContainer/Defuels_writeOff' },
            { $Type: 'UI.DataFieldForAction', Label: 'Reverse',
              Action: 'DefuelService.EntityContainer/Defuels_reverse' },
            { $Type: 'UI.DataFieldForAction', Label: 'Park',
              Action: 'DefuelService.EntityContainer/Defuels_park' }
        ]
    }
);

annotate DefuelService.Defuels with {
    defuel_number   @title: 'Defuel Number';
    movement_type   @title: 'Movement'
                    @Common.FieldControl: #Mandatory
                    @Common.QuickInfo: 'M1 against a known uplift · M2 with none · M3 for re-use · M4 re-uplift from a temporary location · M5 tail to tail.';
    tail_number     @title: 'Tail' @Common.FieldControl: #Mandatory;
    flight_number   @title: 'Flight'
                    @Common.QuickInfo: 'Optional. A defuel on a parked aircraft has no flight, and the captured time is then the only thing that can position it in the ledger.';
    carrier_code    @title: 'Carrier'
                    @Common.FieldControl: #Mandatory
                    @Common.QuickInfo: 'Defaults from the aircraft master and can be changed. It decides how the fuel is valued, so it is captured on the movement rather than resolved later — a carrier read from a master that has since changed would re-value history.';
    reason_text     @title: 'Reason';
    // NO @title ON reason_code. It is the association's GENERATED foreign
    // key, which exists in the OData metadata and not in the CDS model — so
    // annotating it warns and annotates nothing. It still filters; the label
    // comes from the element name.

    location_code   @title: 'Location';
    quantity_kg     @title: 'Quantity (kg)' @Common.FieldControl: #Mandatory;
    quantity_l      @title: 'Quantity (L)';

    density         @title: 'Density'
                    @Common.QuickInfo: 'Blank where none can be resolved — never a standard 0.8 dressed as a measurement, which is a figure nobody can defend to a vendor.';
    density_source  @title: 'Density From';

    valuation_basis @title: 'Valuation Basis'
                    @Common.QuickInfo: 'SPECIFIC where an uplift was named and the fuel takes that uplift price; MAP from the moving average at the preceding ledger entry; FIFO from the tail layers. Recorded on the row because a value without its basis reconciles to nothing.';

    event_local     @title: 'Time (Local)'
                    @Common.FieldControl: #Mandatory
                    @Common.QuickInfo: 'As read at the station. FuelSphere converts to UTC using the station named zone and keeps all three.';
    event_zone      @title: 'Station Time Zone' @Common.FieldControl: #Mandatory;
    event_utc       @title: 'Time (UTC)'
                    @Common.QuickInfo: 'Derived. What the ledger sorts on.';
    event_dst_fold  @title: 'Second Reading Of A Repeated Hour'
                    @Common.QuickInfo: 'Only on the one hour a year that occurs twice when clocks go back. Set it to say which reading was taken; an ambiguous time is refused until it is answered.';

    fuel_value_usd  @title: 'Fuel Value';
    defuel_fee_usd  @title: 'Defuel Fee';
    fee_treatment   @title: 'Fee Treatment'
                    @Common.QuickInfo: 'Capitalise adds the fee to the value of the fuel in the location, so it is part of the shortfall if the vendor credits only the fuel. Expense charges it to the defuelled flight. The same fee is both depending on why the defuel happened, which is why the system asks rather than deriving it.';
    held_value_usd  @title: 'Held Value'
                    @Common.QuickInfo: 'What the airline paid for this fuel, plus a capitalised fee. A credit may never exceed it.';
    settled_qty_kg  @title: 'Settled (kg)';
    credited_usd    @title: 'Credited';
    written_off_usd @title: 'Written Off';
    open_value_usd  @title: 'Still Open'
                    @Common.QuickInfo: 'Held value less what settlement has taken. A parcel is settled in parts until it is exhausted.';
    status          @title: 'Status';
    is_reversed     @title: 'Reversed';
    notes           @title: 'Notes';
    vendor_name     @title: 'Vendor';

    component_base_usd        @title: 'Baseline Cost';
    component_service_fee_usd @title: 'Fuel Services Fee';
    component_airport_fee_usd @title: 'Airport / Royalty Fee'
                              @Common.QuickInfo: 'Held at zero until a source for it exists. FuelSphere splits an uplift cost four ways and this is the fifth; a figure split out by guesswork could not be defended.';
    component_into_plane_usd  @title: 'Into-Plane';
    component_tax_usd         @title: 'Taxes';
}

// ===========================================================================
// The location ledger behind one defuel
// ===========================================================================
annotate DefuelService.DefuelLedgerEntries with @(
    UI: {
        LineItem: [
            { Value: direction,         Label: 'In / out' },
            { Value: qty_kg,            Label: 'Quantity (kg)' },
            { Value: rate_usd_per_kg,   Label: 'Rate' },
            { Value: value_usd,         Label: 'Value' },
            { Value: balance_qty_kg,    Label: 'Balance (kg)' },
            { Value: balance_value_usd, Label: 'Balance value' },
            { Value: valuation_basis,   Label: 'Basis' },
            { Value: batch_ref,         Label: 'Batch' },
            { Value: event_utc,         Label: 'When (UTC)' }
        ]
    }
);

annotate DefuelService.DefuelLedgerEntries with {
    direction         @title: 'In / Out';
    qty_kg            @title: 'Quantity (kg)';
    rate_usd_per_kg   @title: 'Rate';
    value_usd         @title: 'Value';
    balance_qty_kg    @title: 'Balance (kg)';
    balance_value_usd @title: 'Balance Value';
    valuation_basis   @title: 'Basis';
    batch_ref         @title: 'Batch'
                      @Common.QuickInfo: 'The FIFO layer this row drew from. Empty under moving average, where a defuel has a single rate and the question does not arise.';
    event_utc         @title: 'When (UTC)';
}

// ===========================================================================
// The settlements behind one defuel
// ===========================================================================
annotate DefuelService.DefuelSettlements with @(
    UI: {
        LineItem: [
            { Value: outcome,               Label: 'Outcome' },
            { Value: settled_qty_kg,        Label: 'Quantity (kg)' },
            { Value: held_value_usd,        Label: 'Held value' },
            { Value: actual_credit_usd,     Label: 'Credit' },
            { Value: write_off_usd,         Label: 'Written off' },
            { Value: credit_memo_reference, Label: 'Credit memo' },
            { Value: settled_at,            Label: 'Settled at' },
            { Value: notes,                 Label: 'Note' }
        ]
    }
);

annotate DefuelService.DefuelSettlements with {
    outcome               @title: 'Outcome'
                          @Common.QuickInfo: 'S1 full credit · S2 partial credit with the difference written off, which is the normal case · S3 no credit and the whole held value written off.';
    settled_qty_kg        @title: 'Quantity (kg)';
    held_value_usd        @title: 'Held Value';
    actual_credit_usd     @title: 'Credit';
    write_off_usd         @title: 'Written Off';
    credit_memo_reference @title: 'Credit Memo';
    settled_at            @title: 'Settled At';
    notes                 @title: 'Note';
}
