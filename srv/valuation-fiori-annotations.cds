using ValuationService from './valuation-service';

/**
 * FuelSphere - the valuation screens.
 *
 * ONE LIST REPORT, THREE VIEWS. The three tables are three entity sets, shown
 * as three selectable views over one filter bar, which is why there is no
 * object page here and no navigation: a valuation row IS the detail. Opening
 * one would show the same fields again on a page of their own.
 *
 * THE METHOD IS A FILTER, NOT A COLUMN TO SORT BY. FIFO and MAP rows sit in
 * one table, so the first thing any reader does is pick one - it leads the
 * selection fields on all three views for that reason.
 *
 * ALL THREE CARRY THE SAME SEVEN SELECTION FIELDS, and they have to. One filter
 * bar serves all three views, and it applies its conditions to whichever
 * entity set is showing - so a field present on two of them and missing from
 * the third is a filter that 400s the moment the reader switches view. These
 * these seven exist on all three. Two had to be ADDED to make that true
 * rather than dropped from the bar to work around it: line_type to the balance
 * table, and carrier_code to all three on 7 Oct 2026 - a STORED column, never
 * an association, because these tables deliberately reach into nothing.
 *
 * batch_ref is deliberately NOT among them: a FIFO burn spans several batches,
 * so the burn table has no single batch to filter on. It stays a column, where
 * the grid table's own column filter reaches it.
 *
 * EACH VIEW NEEDS A SelectionPresentationVariant, because that is what the
 * manifest's view list points at, and its Text is the label on the selector.
 * Without one the view has no name to show.
 */

// ===========================================================================
// MOVEMENTS
// ===========================================================================
annotate ValuationService.StockMovements with @(
    UI: {
        SelectionFields: [ valuation_method, carrier_code, tail_number, line_type, station, flight_number, flight_date ],

        LineItem: [
            { Value: valuation_method,  Label: 'Method',        ![@UI.Importance]: #High },
            { Value: carrier_code,      Label: 'Carrier',       ![@UI.Importance]: #High },
            { Value: tail_number,       Label: 'Tail',          ![@UI.Importance]: #High },
            { Value: batch_ref,         Label: 'Batch',         ![@UI.Importance]: #High },
            { Value: flight_number,     Label: 'Flight',        ![@UI.Importance]: #High },
            { Value: flight_date,       Label: 'Flight date',   ![@UI.Importance]: #Medium },
            { Value: flight_aobt,       Label: 'AOBT (UTC)',    ![@UI.Importance]: #Low },
            { Value: station,           Label: 'Station',       ![@UI.Importance]: #Medium },
            // WHERE THE FUEL IS WHEN IT IS NOT ON A WING. Set only on the
            // inbound half of a defuel, so it is blank on every flight
            // movement - which is what makes a defuel visible at a glance in
            // a list of thousands of burns and uplifts.
            { Value: storage_location,  Label: 'Storage location', ![@UI.Importance]: #High },
            { Value: reference,         Label: 'Reference',     ![@UI.Importance]: #High },
            { Value: line_type,         Label: 'Line type',     ![@UI.Importance]: #High },
            { Value: qty_cm,            Label: 'Qty',      ![@UI.Importance]: #High },
            { Value: qty_cv,             Label: 'Qty',       ![@UI.Importance]: #Medium },
            { Value: specific_gravity,  Label: 'Sp. gravity',   ![@UI.Importance]: #Low },
            { Value: rate_per_cm,   Label: 'Rate per unit',   ![@UI.Importance]: #High },
            { Value: value_usd,         Label: 'Value',     ![@UI.Importance]: #High },
            // MAP only. Blank on a FIFO row because FIFO has no single running
            // balance - its balance is the open layers, on the Balances view.
            { Value: balance_qty_cm,    Label: 'Balance qty', ![@UI.Importance]: #Medium },
            { Value: balance_value_usd, Label: 'Balance value', ![@UI.Importance]: #Medium },
            { Value: map_per_cm,    Label: 'MAP per unit',    ![@UI.Importance]: #Medium }
        ],

        PresentationVariant: {
            SortOrder: [
                { Property: tail_number },
                { Property: flight_aobt },
                { Property: line_order },
                { Property: sequence }
            ],
            Visualizations: ['@UI.LineItem']
        },

        HeaderInfo: {
            TypeName       : 'Movement',
            TypeNamePlural : 'Stock Movements',
            Title          : { Value: reference },
            Description    : { Value: line_type }
        }
    }
);

annotate ValuationService.StockMovements with {
    valuation_method  @title: 'Valuation method';
    carrier_code      @title: 'Carrier'
                      @Common.QuickInfo: 'The operating carrier, as the IATA code every other FuelSphere screen filters on. Stored on the row and fixed per tail, so the layers of one tail are never filtered away from the burns that consumed them.';
    tail_number       @title: 'Tail';
    batch_ref         @title: 'Batch'
                      @Common.QuickInfo: 'The layer this row draws from or creates. Empty under MAP, which has no layers - one pool, one price.';
    flight_number     @title: 'Flight';
    flight_date       @title: 'Flight date';
    flight_aobt       @title: 'AOBT (UTC)'
                      @Common.QuickInfo: 'Off-block time. FIFO is an ordering rule and a date alone cannot order two uplifts on one day, so this is what the replay sorts on.';
    station           @title: 'Station';
    reference         @title: 'Reference'
                      @Common.QuickInfo: 'What caused the row: the ticket number on an uplift, the burn reference on a burn.';
    line_type         @title: 'Line type';
    qty_kg            @title: 'Qty (kg)'
                      @Common.QuickInfo: 'Signed: positive in, negative out, so the column sums to the net movement.';
    qty_l             @title: 'Qty (L)';
    specific_gravity  @title: 'Sp. gravity';
    rate_usd_per_kg   @title: 'Rate per unit';
    value_usd         @title: 'Value';
    balance_qty_kg    @title: 'Balance qty (kg)';
    balance_value_usd @title: 'Balance value';
    map_usd_per_kg    @title: 'MAP per unit';
    line_order        @title: 'Line order';
    sequence          @title: 'Sequence';
}

// ===========================================================================
// BALANCES
// ===========================================================================
annotate ValuationService.StockBalances with @(
    UI: {
        SelectionFields: [ valuation_method, carrier_code, tail_number, line_type, station, flight_number, flight_date ],

        LineItem: [
            { Value: valuation_method, Label: 'Method',            ![@UI.Importance]: #High },
            { Value: carrier_code,     Label: 'Carrier',           ![@UI.Importance]: #High },
            { Value: tail_number,      Label: 'Tail',              ![@UI.Importance]: #High },
            { Value: batch_ref,        Label: 'Batch',             ![@UI.Importance]: #High },
            // A BALANCE ROW CARRIES EITHER A TAIL OR A TANK, never both. The
            // fuel keeps its batch across the move, so a tank's balance names
            // the same batch the aircraft held it under - and at the same
            // rate, which is what lets it be re-uplifted at what it cost.
            { Value: storage_location, Label: 'Storage location',  ![@UI.Importance]: #High },
            { Value: line_type,        Label: 'Opened by',         ![@UI.Importance]: #Medium },
            { Value: station,          Label: 'Opened at',         ![@UI.Importance]: #Medium },
            { Value: flight_number,    Label: 'Flight',            ![@UI.Importance]: #Medium },
            { Value: flight_date,      Label: 'Flight date',       ![@UI.Importance]: #Medium },
            { Value: uplift_qty_cm,    Label: 'Uplift qty',   ![@UI.Importance]: #High },
            { Value: uplift_qty_cv,     Label: 'Uplift qty',    ![@UI.Importance]: #Low },
            { Value: balance_qty_cm,   Label: 'Balance qty',  ![@UI.Importance]: #High },
            { Value: balance_qty_cv,    Label: 'Balance qty',   ![@UI.Importance]: #Low },
            { Value: specific_gravity, Label: 'Sp. gravity',       ![@UI.Importance]: #Low },
            { Value: rate_per_cm,  Label: 'Rate per unit',       ![@UI.Importance]: #High },
            { Value: value_usd,        Label: 'Value',         ![@UI.Importance]: #High }
        ],

        PresentationVariant: {
            SortOrder: [ { Property: tail_number }, { Property: flight_aobt } ],
            Visualizations: ['@UI.LineItem']
        },

        HeaderInfo: {
            TypeName       : 'Balance',
            TypeNamePlural : 'Stock Balances',
            Title          : { Value: tail_number },
            Description    : { Value: batch_ref }
        }
    }
);

annotate ValuationService.StockBalances with {
    valuation_method @title: 'Valuation method';
    carrier_code      @title: 'Carrier'
                      @Common.QuickInfo: 'The operating carrier, as the IATA code every other FuelSphere screen filters on. Stored on the row and fixed per tail, so the layers of one tail are never filtered away from the burns that consumed them.';
    tail_number      @title: 'Tail';
    batch_ref        @title: 'Batch'
                     @Common.QuickInfo: 'One row per open layer under FIFO. Empty under MAP, which carries a single row per tail.';
    line_type        @title: 'Opened by'
                     @Common.QuickInfo: 'What created this layer - an uplift, the opening balance, a defuel. Empty under MAP, whose single row is the whole pool and was opened by no one movement.';
    station          @title: 'Opened at';
    flight_number    @title: 'Flight';
    flight_date      @title: 'Flight date';
    flight_aobt      @title: 'AOBT (UTC)';
    uplift_qty_kg    @title: 'Uplift qty (kg)';
    uplift_qty_l     @title: 'Uplift qty (L)';
    balance_qty_kg   @title: 'Balance qty (kg)'
                     @Common.QuickInfo: 'What is left of this layer. A fully consumed batch keeps its row at zero - that it is exhausted is a fact worth being able to read.';
    balance_qty_l    @title: 'Balance qty (L)';
    specific_gravity @title: 'Sp. gravity';
    rate_usd_per_kg  @title: 'Rate per unit';
    value_usd        @title: 'Value';
}

// ===========================================================================
// BURN VALUATIONS
// ===========================================================================
annotate ValuationService.BurnValuations with @(
    UI: {
        SelectionFields: [ valuation_method, carrier_code, tail_number, line_type, station, flight_number, flight_date ],

        LineItem: [
            { Value: valuation_method,     Label: 'Method',        ![@UI.Importance]: #High },
            { Value: carrier_code,         Label: 'Carrier',       ![@UI.Importance]: #High },
            { Value: tail_number,          Label: 'Tail',          ![@UI.Importance]: #High },
            { Value: flight_number,        Label: 'Flight',        ![@UI.Importance]: #High },
            { Value: flight_date,          Label: 'Flight date',   ![@UI.Importance]: #Medium },
            { Value: station,              Label: 'Station',       ![@UI.Importance]: #Medium },
            { Value: line_type,            Label: 'Line type',     ![@UI.Importance]: #High },
            { Value: burn_ref,             Label: 'Burn',          ![@UI.Importance]: #High },
            { Value: burn_qty_cm,          Label: 'Burn qty', ![@UI.Importance]: #High },
            { Value: burn_qty_cv,           Label: 'Burn qty',  ![@UI.Importance]: #Low },
            { Value: burn_rate_per_cm, Label: 'Burn rate per unit', ![@UI.Importance]: #High },
            { Value: burn_value_usd,       Label: 'Burn value', ![@UI.Importance]: #High },
            { Value: layers_consumed,      Label: 'Layers',        ![@UI.Importance]: #Medium },
            { Value: qty_basis,            Label: 'Qty basis',     ![@UI.Importance]: #Low }
        ],

        PresentationVariant: {
            SortOrder: [ { Property: tail_number }, { Property: flight_aobt }, { Property: line_type } ],
            Visualizations: ['@UI.LineItem']
        },

        HeaderInfo: {
            TypeName       : 'Burn valuation',
            TypeNamePlural : 'Burn Valuations',
            Title          : { Value: burn_ref },
            Description    : { Value: valuation_method }
        }
    }
);

annotate ValuationService.BurnValuations with {
    valuation_method     @title: 'Valuation method';
    carrier_code      @title: 'Carrier'
                      @Common.QuickInfo: 'The operating carrier, as the IATA code every other FuelSphere screen filters on. Stored on the row and fixed per tail, so the layers of one tail are never filtered away from the burns that consumed them.';
    tail_number          @title: 'Tail';
    flight_number        @title: 'Flight';
    flight_date          @title: 'Flight date';
    flight_aobt          @title: 'AOBT (UTC)';
    station              @title: 'Station';
    line_type            @title: 'Line type';
    burn_ref             @title: 'Burn';
    burn_qty_kg          @title: 'Burn qty (kg)';
    burn_qty_l           @title: 'Burn qty (L)';
    burn_rate_usd_per_kg @title: 'Burn rate per unit'
                         @Common.QuickInfo: 'Derived, never entered: value divided by quantity. Under FIFO it lands between the prices of the layers consumed and belongs to none of them.';
    burn_value_usd       @title: 'Burn value';
    layers_consumed      @title: 'Layers'
                         @Common.QuickInfo: 'How many batches the burn spanned. Always 1 under MAP; under FIFO, more than 1 means the burn crossed a price change.';
    qty_basis            @title: 'Qty basis'
                         @Common.QuickInfo: 'Which quantity was valued. REPORTED_BURN is FUEL_BURNS.actual_burn_kg as reported by ACARS or an import - not the gauge delta the Fuel Overview Report shows, which can differ on the same leg.';
}

// ===========================================================================
// THE THREE VIEWS
// ===========================================================================
//
// One per entity set, and the manifest's view list names them by qualifier.
// Each carries the label the selector shows and the sort that view opens on;
// the SelectionVariant is empty on purpose - the filter bar starts clear, and
// a view that silently pre-filtered would make the same query return
// different totals depending on which tab the reader happened to be on.
annotate ValuationService.StockMovements with @(
    UI.SelectionPresentationVariant #Movements: {
        $Type: 'UI.SelectionPresentationVariantType',
        Text: 'Stock Movements',
        SelectionVariant: { $Type: 'UI.SelectionVariantType', SelectOptions: [] },
        PresentationVariant: {
            $Type: 'UI.PresentationVariantType',
            SortOrder: [
                { Property: tail_number },
                { Property: flight_aobt },
                { Property: line_order },
                { Property: sequence }
            ],
            Visualizations: ['@UI.LineItem']
        }
    }
);

annotate ValuationService.StockBalances with @(
    UI.SelectionPresentationVariant #Balances: {
        $Type: 'UI.SelectionPresentationVariantType',
        Text: 'Stock Balances',
        SelectionVariant: { $Type: 'UI.SelectionVariantType', SelectOptions: [] },
        PresentationVariant: {
            $Type: 'UI.PresentationVariantType',
            SortOrder: [ { Property: tail_number }, { Property: flight_aobt } ],
            Visualizations: ['@UI.LineItem']
        }
    }
);

annotate ValuationService.BurnValuations with @(
    UI.SelectionPresentationVariant #Burns: {
        $Type: 'UI.SelectionPresentationVariantType',
        Text: 'Burn Valuations',
        SelectionVariant: { $Type: 'UI.SelectionVariantType', SelectOptions: [] },
        PresentationVariant: {
            $Type: 'UI.PresentationVariantType',
            SortOrder: [ { Property: tail_number }, { Property: flight_aobt }, { Property: line_type } ],
            Visualizations: ['@UI.LineItem']
        }
    }
);


// ===========================================================================
// Defueling — the documents behind the DEFUEL rows
// ===========================================================================
//
// THE FOURTH VIEW. A reader looking at a DEFUEL movement asks what produced
// it; this is that document, on the same screen rather than another tile.
//
// IMPORTANT COLUMNS ONLY, per the 26 Oct instruction: what identifies the
// movement and what it was worth. The full document lives in the Defueling
// app, which is where it can also be changed.
annotate ValuationService.Defuels with @(
    UI: {
        LineItem: [
            { Value: defuel_id,        Label: 'Defuel No.',        ![@UI.Importance]: #High },
            { Value: defuel_type,      Label: 'Type',              ![@UI.Importance]: #High },
            { Value: tail_number,      Label: 'Tail',              ![@UI.Importance]: #High },
            { Value: flight_number,    Label: 'Flight',            ![@UI.Importance]: #Medium },
            { Value: defuel_date,      Label: 'Defuel date',       ![@UI.Importance]: #High },
            { Value: station_code,     Label: 'Station',           ![@UI.Importance]: #Medium },
            { Value: location_code,    Label: 'Storage location',  ![@UI.Importance]: #High },
            { Value: quantity_kg,      Label: 'Qty (kg)',          ![@UI.Importance]: #High },
            { Value: specific_gravity, Label: 'Sp. gravity',       ![@UI.Importance]: #Low },
            { Value: fuel_value_usd,   Label: 'Fuel value USD',    ![@UI.Importance]: #High },
            { Value: status,           Label: 'Status',            ![@UI.Importance]: #Medium }
        ],

        PresentationVariant: {
            $Type: 'UI.PresentationVariantType',
            SortOrder: [ { Property: defuel_date, Descending: true }, { Property: defuel_id } ],
            Visualizations: ['@UI.LineItem']
        }
    }
);

annotate ValuationService.Defuels with {
    defuel_id        @title: 'Defuel No.';
    defuel_type      @title: 'Type';
    source_mode      @title: 'Recorded against';
    tail_number      @title: 'Tail';
    carrier_code     @title: 'Carrier';
    flight_number    @title: 'Flight';
    flight_date      @title: 'Flight date';
    station_code     @title: 'Station';
    defuel_date      @title: 'Defuel date';
    defuel_time      @title: 'Defuel time';
    location_code    @title: 'Storage location';
    quantity_kg      @title: 'Qty (kg)';
    specific_gravity @title: 'Sp. gravity';
    fuel_value_usd   @title: 'Fuel value USD';
    status           @title: 'Status';
};

// NEWEST FIRST, unlike the three valuation views.
//
// Those are a replay and read oldest-first, because the order IS the
// algorithm. This one is a worklist: the defuel somebody just recorded is the
// one they want to see, and a station user scrolling to the bottom of a
// thousand historical documents to find today's is the wrong default.
annotate ValuationService.Defuels with @(
    UI.SelectionPresentationVariant #Defuels: {
        $Type: 'UI.SelectionPresentationVariantType',
        Text: 'Defueling',
        SelectionVariant: { $Type: 'UI.SelectionVariantType', SelectOptions: [] },
        PresentationVariant: {
            $Type: 'UI.PresentationVariantType',
            SortOrder: [ { Property: defuel_date, Descending: true }, { Property: defuel_id } ],
            Visualizations: ['@UI.LineItem']
        }
    }
);


// ===========================================================================
// Defuel Movements — the ledger lines a defuel wrote
// ===========================================================================
//
// A FIFTH VIEW, AND THE ONLY ONE THAT PRE-FILTERS. The three valuation views
// deliberately open unfiltered, because a view that silently narrowed would
// make the same query return different totals depending on which tab the
// reader was on. This one is different in kind: it is not another way of
// reading the valuation, it is a worklist for the handful of rows a defuel
// produced among twelve thousand burns and uplifts.
//
// WITHOUT IT THE LINES ARE EFFECTIVELY INVISIBLE. Six rows in 12,882, in a
// table that shows fifteen at a time, reachable only by knowing to filter on
// a line type - which is the reported "defuel entries not appearing".
//
// NEWEST FIRST, unlike the replay views: somebody checking a defuel they just
// recorded wants it at the top, not buried under a year of history.
annotate ValuationService.StockMovements with @(
    UI.SelectionPresentationVariant #DefuelMovements: {
        $Type: 'UI.SelectionPresentationVariantType',
        Text: 'Defuel Movements',
        SelectionVariant: {
            $Type: 'UI.SelectionVariantType',
            SelectOptions: [{
                $Type: 'UI.SelectOptionType',
                PropertyName: line_type,
                Ranges: [{
                    $Type: 'UI.SelectionRangeType',
                    Sign: #I, Option: #EQ, Low: 'DEFUEL'
                }]
            }]
        },
        PresentationVariant: {
            $Type: 'UI.PresentationVariantType',
            SortOrder: [
                { Property: flight_aobt, Descending: true },
                { Property: reference },
                { Property: sequence }
            ],
            Visualizations: ['@UI.LineItem']
        }
    }
);
