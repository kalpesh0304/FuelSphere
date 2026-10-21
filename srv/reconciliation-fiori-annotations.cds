using ReconciliationService from './reconciliation-service';

/**
 * FS Reconciliation - the Financials-to-FuelSphere tile.
 *
 * THE COLUMN ORDER IS THE SPECIFICATION'S ORDER, and deliberately so. The
 * sheet reads left to right as an argument: here is what Finance has, here is
 * what we have, here is what has not reached them yet, here is where the fuel
 * went, and here is what is left over. Re-ordering it to put the "interesting"
 * columns first would break the one thing that makes a reconciliation
 * readable, which is that each column follows from the one before it.
 *
 * THE PLACEHOLDER IS SHOWN, NOT HIDDEN. net_uplift_finance is a copy of
 * net_uplift_fs until the G/L service exists, so the two columns agree
 * perfectly and the variance beside them is always zero. finance_source sits
 * in the table as its own column for exactly that reason: a reader who sees
 * a perfect reconciliation must be able to see, without hovering or drilling,
 * that nothing has been reconciled yet.
 */
annotate ReconciliationService.FinanceReconciliation with @(

    UI: {
        // ---- the filter bar the specification asks for -------------------
        //
        // "The filters on top show the fiscal year, Carrier code & option YTD
        // and Period wise." All three, in that order.
        SelectionFields: [ fiscal_year, carrier_code, period_mode ],

        PresentationVariant: {
            $Type: 'UI.PresentationVariantType',
            SortOrder: [
                { $Type: 'Common.SortOrderType', Property: carrier_code, Descending: false },
                { $Type: 'Common.SortOrderType', Property: period,       Descending: false }
            ],
            Visualizations: ['@UI.LineItem']
        },

        LineItem: [
            { Value: carrier_code,  Label: 'Carrier',  ![@UI.Importance]: #High },
            { Value: period_label,  Label: 'Period',   ![@UI.Importance]: #High },

            // ---- the comparison --------------------------------------------
            { Value: net_uplift_finance, Label: 'Net uplift (finance books)',
              ![@UI.Importance]: #High },

            // IMMEDIATELY BESIDE THE FIGURE IT QUALIFIES. A reader scanning
            // the two uplift columns and finding them equal needs this in the
            // same glance, not three columns away.
            { Value: finance_source, Label: 'Finance source',
              ![@UI.Importance]: #High },

            { Value: net_uplift_fs, Label: 'Net uplift (FuelSphere)',
              ![@UI.Importance]: #High },

            { Value: jv_pending_posting, Label: 'JV pending posting',
              ![@UI.Importance]: #High },

            { Value: posted_subsequent_period, Label: 'Posted in next period',
              ![@UI.Importance]: #Medium },
            { Value: unplaced_posting_value, Label: 'Posted, period unknown',
              ![@UI.Importance]: #Medium },

            // ---- where the fuel went ----------------------------------------
            { Value: block_burn,        Label: 'Block burn',      ![@UI.Importance]: #High },
            { Value: apu_burn,          Label: 'APU burn',        ![@UI.Importance]: #Medium },
            { Value: other_allocations, Label: 'Adjustments',     ![@UI.Importance]: #Medium },
            { Value: total_allocated,   Label: 'Total allocated', ![@UI.Importance]: #Medium },
            { Value: remaining_stock,   Label: 'Remaining stock', ![@UI.Importance]: #High },

            // THE ANSWER COLUMN. Criticality rather than a plain number: zero
            // is the expected reading, and anything else is a finding that has
            // to survive a reader skimming twelve rows.
            { Value: unallocated_burn, Label: 'Unallocated burn',
              Criticality: unallocatedCriticality, ![@UI.Importance]: #High },

            { Value: net_uplift_expected, Label: 'Posted to S/4',  ![@UI.Importance]: #Low },
            { Value: opening_stock_value, Label: 'Opening stock',  ![@UI.Importance]: #Low },
            { Value: uplift_count,        Label: 'Uplifts',        ![@UI.Importance]: #Low },
            { Value: pending_count,       Label: 'Unposted',       ![@UI.Importance]: #Low },
            { Value: company_code,        Label: 'Company code',   ![@UI.Importance]: #Low },
            { Value: fiscal_year,         Label: 'Fiscal year',    ![@UI.Importance]: #Low }
        ],

        HeaderInfo: {
            TypeName       : 'Reconciliation',
            TypeNamePlural : 'FS Reconciliation',
            Title          : { Value: period_label },
            Description    : { Value: carrier_name }
        },

        // ---- the drill-down ----------------------------------------------
        //
        // "Drill down in any row shows the GL level recon (Will share details
        // subsequently)." The G/L-level sheet has not arrived. These are the
        // two things that ARE knowable, and both answer the question a reader
        // opens the row with: where did this number come from?
        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'Comparison',
              Target: '@UI.FieldGroup#Comparison', Label: 'Finance vs FuelSphere' },
            { $Type: 'UI.ReferenceFacet', ID: 'Allocation',
              Target: '@UI.FieldGroup#Allocation', Label: 'Where the fuel went' },
            { $Type: 'UI.ReferenceFacet', ID: 'GlRecon',
              Target: 'gl_accounts/@UI.LineItem', Label: 'G/L account reconciliation' },
            { $Type: 'UI.ReferenceFacet', ID: 'Uplifts',
              Target: 'uplift_lines/@UI.LineItem', Label: 'Uplifts in this period' }
        ],

        FieldGroup #Comparison: {
            Data: [
                { Value: carrier_code,             Label: 'Carrier' },
                { Value: carrier_name,             Label: 'Carrier name' },
                { Value: company_code,             Label: 'Company code' },
                { Value: fiscal_year,              Label: 'Fiscal year' },
                { Value: period_label,             Label: 'Period' },
                { Value: period_mode,              Label: 'Basis' },
                { Value: net_uplift_finance,       Label: 'Net uplift (finance books)' },
                { Value: finance_source,           Label: 'Finance figure source' },
                { Value: net_uplift_fs,            Label: 'Net uplift (FuelSphere)' },
                { Value: net_uplift_expected,      Label: 'Posted successfully to S/4' },
                { Value: jv_pending_posting,       Label: 'JV pending posting' },
                { Value: finance_variance,         Label: 'Variance',
                  Criticality: varianceCriticality },
                { Value: posted_subsequent_period, Label: 'Posted in a later period' },
                { Value: unplaced_posting_value,   Label: 'Posted, period unknown' },
                { Value: unplaced_posting_count,   Label: 'Postings with no FI date' },
                { Value: uplift_count,             Label: 'Uplifts in period' },
                { Value: posted_count,             Label: 'Posted' },
                { Value: pending_count,            Label: 'Pending or in error' }
            ]
        },

        FieldGroup #Allocation: {
            Data: [
                { Value: opening_stock_value, Label: 'Opening stock' },
                { Value: net_uplift_fs,       Label: 'Net uplift' },
                { Value: block_burn,          Label: 'Block burn' },
                { Value: apu_burn,            Label: 'APU burn' },
                { Value: other_allocations,   Label: 'Other allocations' },
                { Value: total_allocated,     Label: 'Total allocated' },
                { Value: remaining_stock,     Label: 'Remaining stock' },
                { Value: unallocated_burn,    Label: 'Unallocated burn',
                  Criticality: unallocatedCriticality }
            ]
        }
    }
);

annotate ReconciliationService.FinanceReconciliation with {
    carrier_code     @title: 'Carrier Code';
    carrier_name     @title: 'Carrier';
    company_code     @title: 'Company Code';
    fiscal_year      @title: 'Fiscal Year'
                     @Common.QuickInfo: 'Calendar year. FuelSphere holds no fiscal year variant, so a carrier whose fiscal year does not start in January will need one before this column can mean what Finance means by it.';
    period           @title: 'Period';
    period_label     @title: 'Period';
    period_mode      @title: 'Basis'
                     @Common.QuickInfo: 'Monthly shows one row per period. YTD collapses the year into a single row per carrier - summed from the same months, never recomputed.';

    net_uplift_finance @title: 'Net Uplift (Finance Books)'
                       @Measures.ISOCurrency: currency_code
                       @Common.QuickInfo: 'The balance of the carrier fuel G/L accounts. Currently a copy of the FuelSphere figure - see Finance source - because the G/L OData service does not exist yet.';

    finance_source   @title: 'Finance Source'
                     @Common.QuickInfo: 'SEEDED_FROM_FS means the finance figure is a placeholder copied from FuelSphere, so the variance beside it is zero by construction and means nothing. It becomes S4_GL once the G/L service is connected.';

    net_uplift_fs    @title: 'Net Uplift (FuelSphere)'
                     @Measures.ISOCurrency: currency_code
                     @Common.QuickInfo: 'Every uplift and defuel flown in the period, whatever its S/4 posting status. This is what FuelSphere believes went into the wing.';

    net_uplift_expected @title: 'Posted To S/4'
                        @Measures.ISOCurrency: currency_code
                        @Common.QuickInfo: 'The part of the uplift that posted successfully. A partial posting is not counted here: it created some documents and not others, and calling it posted would tell Finance the value is in the books when part of it is not.';

    jv_pending_posting @title: 'JV Pending Posting'
                       @Measures.ISOCurrency: currency_code
                       @Common.QuickInfo: 'Uplift value in error or never sent to S/4. This is the accrual Finance has to book manually at close - which is why the screen is wanted before close rather than after it.';

    posted_subsequent_period @title: 'Posted In Next Period'
                             @Measures.ISOCurrency: currency_code
                             @Common.QuickInfo: 'Signed. A January uplift whose FI document posted in February shows as positive on January and negative on February, so the column nets to zero across the year. Reads zero until S/4 returns the FI posting date.';

    unplaced_posting_value @title: 'Posted, Period Unknown'
                           @Measures.ISOCurrency: currency_code
                           @Common.QuickInfo: 'Uplift that S/4 accepted but whose FI posting date it did not return, so the period it landed in is not known. While this is non-zero, a zero in "Posted in next period" means "we cannot tell", not "nothing shifted". It empties when CR-2a lands.';
    unplaced_posting_count @title: 'Postings With No FI Date';

    opening_stock_value @title: 'Opening Stock'  @Measures.ISOCurrency: currency_code;
    block_burn          @title: 'Block Burn'     @Measures.ISOCurrency: currency_code;
    apu_burn            @title: 'APU Burn'       @Measures.ISOCurrency: currency_code;

    other_allocations   @title: 'Other Allocations'
                        @Measures.ISOCurrency: currency_code
                        @Common.QuickInfo: 'Manual burn adjustments, transfers between tails, jettison.';

    total_allocated     @title: 'Total Allocated' @Measures.ISOCurrency: currency_code;

    remaining_stock     @title: 'Remaining Stock'
                        @Measures.ISOCurrency: currency_code
                        @Common.QuickInfo: 'Closing stock value AS RECORDED on the valuation ledger - read, never derived from the movements above it. That independence is what lets unallocated burn be non-zero at all.';

    unallocated_burn    @title: 'Unallocated Burn'
                        @Measures.ISOCurrency: currency_code
                        @Common.QuickInfo: 'Opening + net uplift - block - APU - other - closing. Zero when the ledger agrees with itself. Anything else is fuel that left the tanks with nothing saying where it went.';

    finance_variance    @title: 'Variance' @Measures.ISOCurrency: currency_code;
    currency_code       @title: 'Currency' @Common.IsCurrency;

    uplift_count        @title: 'Uplifts';
    posted_count        @title: 'Posted';
    pending_count       @title: 'Pending';
}

annotate ReconciliationService.ReconciliationGlLine with @(
    UI: {
        LineItem: [
            { Value: gl_account,     Label: 'G/L account' },
            { Value: description,    Label: 'Description' },
            { Value: account_role,   Label: 'Role' },
            { Value: company_code,   Label: 'Company code' },
            { Value: expected_value, Label: 'Expected from FuelSphere' },
            { Value: booked_value,   Label: 'Booked in finance' },
            { Value: variance,       Label: 'Variance' }
        ]
    }
);

annotate ReconciliationService.ReconciliationGlLine with {
    gl_account     @title: 'G/L Account';
    description    @title: 'Description';
    account_role   @title: 'Role';
    company_code   @title: 'Company Code';
    expected_value @title: 'Expected From FuelSphere' @Measures.ISOCurrency: currency_code
                   @Common.QuickInfo: 'Split evenly across the accounts carrying this role. FuelSphere does not know how S/4 divided one from the other - that comes from account determination inside S/4 - so this is an apportionment, not a posting.';
    booked_value   @title: 'Booked In Finance' @Measures.ISOCurrency: currency_code
                   @Common.QuickInfo: 'Empty until the G/L OData service exists. Empty means not known; it does not mean nothing was booked.';
    variance       @title: 'Variance' @Measures.ISOCurrency: currency_code;
    currency_code  @title: 'Currency' @Common.IsCurrency;
}

annotate ReconciliationService.ReconciliationUpliftLine with @(
    UI: {
        LineItem: [
            { Value: ticket_number,  Label: 'Ticket' },
            { Value: flight_date,    Label: 'Flight date' },
            { Value: flight_number,  Label: 'Flight' },
            { Value: tail_number,    Label: 'Tail' },
            { Value: station,        Label: 'Station' },
            { Value: qty_kg,         Label: 'Quantity' },
            { Value: value_usd,      Label: 'Value' },
            { Value: posting_status, Label: 'S/4 status', Criticality: statusCriticality },
            { Value: s4_po_number,   Label: 'Purchase order' },
            { Value: fi_period,      Label: 'FI period' },
            { Value: s4_message,     Label: 'S/4 message' }
        ]
    }
);

annotate ReconciliationService.ReconciliationUpliftLine with {
    ticket_number     @title: 'Ticket';
    internal_number   @title: 'Internal No';
    tail_number       @title: 'Tail';
    station           @title: 'Station';
    flight_number     @title: 'Flight';
    flight_date       @title: 'Flight Date';
    qty_kg            @title: 'Quantity (kg)';
    value_usd         @title: 'Value' @Measures.ISOCurrency: currency_code;
    posting_status    @title: 'S/4 Status'
                      @Common.QuickInfo: 'NOT_SENT means nobody has tried to post it, which is a different problem from ERROR - S/4 refusing it - and has a different owner.';
    s4_po_number      @title: 'Purchase Order';
    s4_message        @title: 'S/4 Message';
    fi_period         @title: 'FI Period';
    is_period_shifted @title: 'Posted In Another Period';
    currency_code     @title: 'Currency' @Common.IsCurrency;
}

/**
 * The G/L account mapping, as a maintainable list.
 *
 * SMALL, AND THE ONLY THING ON THIS SERVICE ANYBODY TYPES INTO. It is also
 * where a wrong reconciliation usually starts: an account added to the chart
 * and not added here is fuel the screen cannot explain.
 */
annotate ReconciliationService.ReconGlAccounts with @(
    UI: {
        SelectionFields: [ carrier_code, account_role, is_active ],
        LineItem: [
            { Value: carrier_code, Label: 'Carrier' },
            { Value: gl_account,           Label: 'G/L account' },
            { Value: description,          Label: 'Description' },
            { Value: account_role,         Label: 'Role' },
            { Value: company_code,         Label: 'Company code' },
            { Value: valid_from,           Label: 'Valid from' },
            { Value: valid_to,             Label: 'Valid to' },
            { Value: is_active,            Label: 'Active' }
        ],
        HeaderInfo: {
            TypeName       : 'G/L Account',
            TypeNamePlural : 'Fuel G/L Accounts',
            Title          : { Value: gl_account },
            Description    : { Value: description }
        },
        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'Account',
              Target: '@UI.FieldGroup#Account', Label: 'Account' }
        ],
        FieldGroup #Account: {
            Data: [
                { Value: carrier_code, Label: 'Carrier' },
                { Value: company_code,         Label: 'Company code' },
                { Value: gl_account,           Label: 'G/L account' },
                { Value: account_role,         Label: 'Role' },
                { Value: description,          Label: 'Description' },
                { Value: valid_from,           Label: 'Valid from' },
                { Value: valid_to,             Label: 'Valid to' },
                { Value: is_active,            Label: 'Active' },
                { Value: notes,                Label: 'Notes' }
            ]
        }
    }
);

annotate ReconciliationService.ReconGlAccounts with {
    carrier_code @title: 'Carrier';
    gl_account   @title: 'G/L Account'
                 @Common.QuickInfo: 'SAKNR as S/4 carries it - a string, because 600780 keeps its leading zeros in some charts of accounts and loses them in none.';
    account_role @title: 'Role'
                 @Common.QuickInfo: 'What the account is for: UPLIFT, BLOCK_BURN, APU_BURN, ADJUSTMENT, STOCK or ACCRUAL. The reconciliation adds these to different sides of the same comparison, so an account with no role is a number the screen can show and the arithmetic cannot use.';
    description  @title: 'Description';
    company_code @title: 'Company Code';
    valid_from   @title: 'Valid From';
    valid_to     @title: 'Valid To';
    is_active    @title: 'Active';
    notes        @title: 'Notes';
}
