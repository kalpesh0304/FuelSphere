using TicketService from './ticket-service';

/**
 * FuelSphere - the S/4 posting log.
 *
 * THE TILE THE BUSINESS ASKED FOR, in its own words: error details "logged
 * (similar to SAP application log) and accessible via a tile to understand
 * reason of error and resolution".
 *
 * IT OPENS ON THE FAILURES, which is the whole reason it exists - a list of
 * every posting that ever succeeded is a list nobody opens. The default
 * variant filters to failures; clearing that filter shows the successes
 * beside them, because after fixing a configuration problem the useful view
 * is the repost that worked next to the error it replaced.
 *
 * THE MESSAGE CLASS AND NUMBER ARE ON THE ROW, not one click in. "M8 215" is
 * how a functional person recognises the missing tolerance key without
 * reading a sentence, and a log that hides it makes them open every row.
 *
 * NO OBJECT PAGE NAVIGATION FROM THE LIST ITSELF - the detail IS the
 * messages, and they are a table under the row rather than a page of their
 * own. The one link that matters goes the other way: out to the ticket, which
 * is where somebody acts on what they have read.
 */
annotate TicketService.S4PostingErrors with @(
    UI: {
        SelectionFields: [
            is_failure, outcome, posting_kind, attempted_at,
            ticket_number, aircraft_reg, flight_number, company_code
        ],

        LineItem: [
            { Value: attempted_at,   Label: 'When',            ![@UI.Importance]: #High },
            { Value: outcome,        Label: 'Outcome',         ![@UI.Importance]: #High,
              Criticality: outcomeCriticality },
            { Value: posting_kind,   Label: 'Posting',         ![@UI.Importance]: #High },

            // THE TICKET, AND A WAY BACK TO IT. A log row is read in order to
            // do something about a ticket, so the number is here and the
            // navigation below goes to it.
            { Value: ticket_number,  Label: 'Ticket',          ![@UI.Importance]: #High },
            { Value: internal_number, Label: 'Internal no',    ![@UI.Importance]: #Low },
            { Value: aircraft_reg,   Label: 'Tail',            ![@UI.Importance]: #Medium },
            { Value: flight_number,  Label: 'Flight',          ![@UI.Importance]: #Medium },

            { Value: message,        Label: 'Message',         ![@UI.Importance]: #High },
            { Value: attempt_no,     Label: 'Attempt',         ![@UI.Importance]: #Medium },

            // What did get created, where anything did. On a failure these
            // are empty, and that emptiness is the finding.
            { Value: po_number,      Label: 'Purchase order',  ![@UI.Importance]: #Medium },
            { Value: gr_number,      Label: 'Goods receipt',   ![@UI.Importance]: #Medium },
            { Value: fi_doc_number,  Label: 'FI document',     ![@UI.Importance]: #Low },
            { Value: company_code,   Label: 'Company code',    ![@UI.Importance]: #Low },
            { Value: contract_number, Label: 'Contract',       ![@UI.Importance]: #Low },

            {
                $Type          : 'UI.DataFieldForIntentBasedNavigation',
                Label          : 'Open the fuel ticket',
                SemanticObject : 'fueltickets',
                Action         : 'manage',
                Mapping        : [
                    { $Type: 'Common.SemanticObjectMappingType',
                      LocalProperty: ticket_ID, SemanticObjectProperty: 'ID' },
                    { $Type: 'Common.SemanticObjectMappingType',
                      LocalProperty: ticket_number, SemanticObjectProperty: 'ticket_number' }
                ],
                ![@UI.Importance]: #High
            }
        ],

        // NEWEST FIRST. An error log is read from the top: what broke most
        // recently is what somebody is being asked about.
        PresentationVariant: {
            SortOrder: [ { Property: attempted_at, Descending: true } ],
            Visualizations: ['@UI.LineItem']
        },

        // ---- THE TWO VIEWS, WITH EVERYTHING INLINE ---------------------
        //
        // INLINE AND NOT ![@UI.SelectionVariant#Failures], and this is worth
        // knowing before anyone "tidies" it back.
        //
        // A reference in this position does NOT compile to an AnnotationPath.
        // CAP emits it as `<PropertyValue Property="SelectionVariant"
        // Path="@UI.SelectionVariant#Failures"/>` - a PROPERTY path, naming a
        // property that cannot exist, because `@UI.SelectionVariant#Failures`
        // is an annotation and not a column. Fiori Elements resolves it
        // anyway, which is exactly why it survived: nothing on screen looked
        // wrong.
        //
        // d50-annotation-sweep EXIT-3 is what found it, the first time that
        // sweep ever ran over this file - it had been skipped for as long as
        // the service count beside it was stale, which is the failure mode
        // that harness warns about in its own comments.
        //
        // The duplication below is the price, and it is small: two
        // Visualizations lines and one sort order.
        SelectionPresentationVariant #Failures: {
            $Type: 'UI.SelectionPresentationVariantType',
            Text: 'Failures',
            // The default view. A SelectionVariant rather than a filter baked
            // into the entity, so a reader can clear it and see the
            // successful repost beside the error it replaced.
            SelectionVariant: {
                $Type: 'UI.SelectionVariantType',
                Text: 'Failures',
                SelectOptions: [{
                    $Type: 'UI.SelectOptionType',
                    PropertyName: is_failure,
                    Ranges: [{ $Type: 'UI.SelectionRangeType', Sign: #I, Option: #EQ, Low: true }]
                }]
            },
            PresentationVariant: {
                $Type: 'UI.PresentationVariantType',
                SortOrder: [{ $Type: 'Common.SortOrderType',
                              Property: attempted_at, Descending: true }],
                Visualizations: ['@UI.LineItem']
            }
        },

        SelectionPresentationVariant #All: {
            $Type: 'UI.SelectionPresentationVariantType',
            Text: 'All postings',
            SelectionVariant: { $Type: 'UI.SelectionVariantType', SelectOptions: [] },
            PresentationVariant: {
                $Type: 'UI.PresentationVariantType',
                SortOrder: [{ $Type: 'Common.SortOrderType',
                              Property: attempted_at, Descending: true }],
                Visualizations: ['@UI.LineItem']
            }
        },

        HeaderInfo: {
            TypeName       : 'Posting',
            TypeNamePlural : 'S/4HANA Postings',
            Title          : { Value: ticket_number },
            Description    : { Value: message }
        },

        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'WhatHappened',
              Target: '@UI.FieldGroup#WhatHappened', Label: 'What happened' },
            { $Type: 'UI.ReferenceFacet', ID: 'LogMessages',
              Target: 'messages/@UI.LineItem', Label: 'S/4HANA Messages' },
            // ---- WHAT WE SENT, added 19 Oct 2026 ------------------------
            //
            // ITS OWN SECTION, NOT A FIELD IN THE GROUP ABOVE. The payload is
            // twenty lines of JSON; dropped into a two-column field group it
            // would wrap into illegibility and push the document numbers off
            // the fold. A reader needs the numbers at a glance and the
            // payload only when the numbers do not explain themselves.
            //
            // AFTER THE MESSAGES, DELIBERATELY. The order is the order the
            // question gets asked: what failed, what S/4 said, then what we
            // had sent to make it say that.
            { $Type: 'UI.ReferenceFacet', ID: 'Payload',
              Target: '@UI.FieldGroup#Payload', Label: 'Payload sent to S/4HANA' }
        ],

        // One field, full width, in a multi-line control - see the
        // MultiLineText annotation below.
        FieldGroup #Payload: {
            Data: [ { Value: request_payload, Label: 'Request' } ]
        },

        FieldGroup #WhatHappened: {
            Data: [
                { Value: ticket_number,      Label: 'Ticket' },
                { Value: internal_number,    Label: 'Internal no' },
                { Value: aircraft_reg,       Label: 'Tail' },
                { Value: flight_number,      Label: 'Flight' },
                { Value: delivery_timestamp, Label: 'Uplift at' },
                { Value: attempt_no,         Label: 'Attempt' },
                { Value: posting_kind,       Label: 'Posting' },
                { Value: outcome,            Label: 'Outcome', Criticality: outcomeCriticality },
                { Value: attempted_at,       Label: 'Attempted at' },
                { Value: message,            Label: 'Message' },
                { Value: company_code,       Label: 'Company code' },
                { Value: contract_number,    Label: 'Contract called off' },
                { Value: po_number,          Label: 'Purchase order' },
                { Value: po_item,            Label: 'PO item' },
                { Value: gr_number,          Label: 'Goods receipt' },
                { Value: gr_year,            Label: 'GR year' },
                { Value: fi_doc_number,      Label: 'FI document' },
                { Value: fi_fiscal_year,     Label: 'FI fiscal year' },
                { Value: invoice_number,     Label: 'S/4 invoice' },
                { Value: supplier_invoice_number, Label: 'Supplier invoice no' }
            ]
        }
    }
);

annotate TicketService.S4PostingErrors with {
    is_failure         @title: 'Failed only'
                       @Common.QuickInfo: 'The log opens on failures. Clear this to see the successful postings beside them - which is how you confirm a configuration fix worked.';
    ticket_number      @title: 'Ticket';
    internal_number    @title: 'Internal No';
    aircraft_reg       @title: 'Tail';
    flight_number      @title: 'Flight';
    delivery_timestamp @title: 'Uplift At';

    // ---- THE FILTER BAR WAS SHOWING RAW COLUMN NAMES -------------------
    //
    // outcome, posting_kind, attempted_at and company_code had no @title, so
    // the filter bar rendered them as "outcome:", "posting_kind:",
    // "attempted_at:" and "company_code:" - the database's words in front of
    // a person who does not read the database. Everything on a filter bar is
    // a label somebody has to understand under time pressure.
    attempted_at       @title: 'Posted At'
                       @Common.QuickInfo: 'When FuelSphere called S/4 - not the date S/4 booked against. The two differ at month end, which is when it matters.';

    outcome            @title: 'Outcome'
                       @Common.QuickInfo: 'S both documents posted; POERR the purchase order failed and nothing posted; GRERR the PO posted and the goods receipt failed; P partial; E error.';

    posting_kind       @title: 'Posting'
                       @Common.QuickInfo: 'Which posting this was: the uplift PO and GR, the into-plane service chain, a goods issue from own storage, a supplier invoice, or a reversal.';

    company_code       @title: 'Company Code';
    contract_number    @title: 'Contract Called Off';
    po_number          @title: 'Purchase Order';
    po_item            @title: 'PO Item';
    po_quantity        @title: 'PO Quantity';
    po_unit            @title: 'PO Unit';
    gr_number          @title: 'Goods Receipt';
    gr_year            @title: 'GR Year';
    fi_doc_number      @title: 'FI Document';
    fi_fiscal_year     @title: 'FI Fiscal Year';
    fi_posting_date    @title: 'FI Posting Date'
                       @Common.QuickInfo: 'The date S/4 booked against. Empty until ZFS_FUEL_POSTING_SRV returns it - CR-2a.';
    invoice_number     @title: 'S/4 Invoice';
    invoice_year       @title: 'Invoice Year';
    supplier_invoice_number @title: 'Supplier Invoice No';
    attempt_no         @title: 'Attempt';
    message            @title: 'Message';

    // THE JSON AS A BLOCK, NOT A ONE-LINE INPUT. Without MultiLineText this
    // renders as a single-line field showing the first forty characters of a
    // twenty-line document, which is the same as showing nothing.
    request_payload    @title: 'Payload Sent To S/4HANA'
                       @UI.MultiLineText
                       @Common.QuickInfo: 'Exactly what FuelSphere sent, as JSON, including _resolvedFrom - which mapping table answered for each field. A posting S/4 refused is only half explained by the refusal; this is the other half.';
}
