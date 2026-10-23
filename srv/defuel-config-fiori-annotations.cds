using DefuelConfigService from './defuel-config-service';

/**
 * Defuel Configuration — three masters, three views, one app.
 *
 * THE ANNOTATIONS LIVE HERE AND NOWHERE ELSE. The deployed Fiori apps in this
 * estate carry empty annotation stubs and take every column, filter and facet
 * from this project through $metadata (CLAUDE.md §17). A second definition in
 * the app folder is a second definition that drifts.
 *
 * RENDERING IS UNVERIFIED FROM HERE. ui5.sap.com answers 403 in this
 * container, so "the annotations emit and every path resolves" and "a person
 * can see it" are different claims. Only the second one matters to a user and
 * only a person with a browser can make it.
 */

// ===========================================================================
// Storage locations
// ===========================================================================
annotate DefuelConfigService.StorageLocations with @(
    UI: {
        SelectionFields: [ station_code, location_type, is_active ],

        LineItem: [
            { Value: code,          Label: 'Location', ![@UI.Importance]: #High },
            { Value: description,   Label: 'Description' },
            { Value: station_code,  Label: 'Station',  ![@UI.Importance]: #High },
            // THE COLUMN THAT DECIDES A REFUSAL. R2.4 blocks uplift out of a
            // DEFUEL location, so which type a location is governs what can
            // be done with the fuel in it — not a detail to be buried on the
            // object page.
            { Value: location_type, Label: 'Type',     ![@UI.Importance]: #High },
            { Value: capacity_kg,   Label: 'Capacity (kg)' },
            { Value: valid_from,    Label: 'Valid from' },
            { Value: valid_to,      Label: 'Valid to' },
            { Value: is_active,     Label: 'Active' }
        ],

        HeaderInfo: {
            TypeName       : 'Storage Location',
            TypeNamePlural : 'Storage Locations',
            Title          : { Value: code },
            Description    : { Value: description }
        },

        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'Location',
              Target: '@UI.FieldGroup#Location', Label: 'Location' }
        ],

        FieldGroup #Location: {
            Data: [
                { Value: code,          Label: 'Location code' },
                { Value: description,   Label: 'Description' },
                { Value: airport_iata,  Label: 'Airport' },
                { Value: station_code,  Label: 'Station' },
                { Value: location_type, Label: 'Type' },
                { Value: capacity_kg,   Label: 'Capacity (kg)' },
                { Value: valid_from,    Label: 'Valid from' },
                { Value: valid_to,      Label: 'Valid to' },
                { Value: is_active,     Label: 'Active' },
                { Value: notes,         Label: 'Notes' }
            ]
        }
    }
);

annotate DefuelConfigService.StorageLocations with {
    code          @title: 'Location Code'
                  @Common.FieldControl: #Mandatory;
    description   @title: 'Description';
    airport_iata  @title: 'Airport';
    station_code  @title: 'Station'
                  @Common.FieldControl: #Mandatory;
    location_type @title: 'Type'
                  @Common.FieldControl: #Mandatory
                  @Common.QuickInfo: 'DEFUEL holds fuel going back to the vendor or to disposal, and uplift OUT of it is refused — the return may already be priced and accrued. TEMP holds fuel waiting for another aircraft, and uplift out is permitted.';
    capacity_kg   @title: 'Capacity (kg)'
                  @Common.QuickInfo: 'Advisory. A negative balance is refused because it means fuel went missing; an over-full tank is a physical impossibility the system cannot detect and should not pretend to.';
    valid_from    @title: 'Valid From';
    valid_to      @title: 'Valid To';
    is_active     @title: 'Active';
    notes         @title: 'Notes';
}

// ===========================================================================
// Reason codes
// ===========================================================================
annotate DefuelConfigService.DefuelReasonCodes with @(
    UI: {
        SelectionFields: [ is_active ],

        LineItem: [
            { Value: code,            Label: 'Reason', ![@UI.Importance]: #High },
            { Value: description,     Label: 'Description', ![@UI.Importance]: #High },
            { Value: credit_expected, Label: 'Credit usually expected' },
            { Value: valid_from,      Label: 'Valid from' },
            { Value: valid_to,        Label: 'Valid to' },
            { Value: is_active,       Label: 'Active' }
        ],

        HeaderInfo: {
            TypeName       : 'Reason Code',
            TypeNamePlural : 'Defuel Reason Codes',
            Title          : { Value: code },
            Description    : { Value: description }
        },

        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'Reason',
              Target: '@UI.FieldGroup#Reason', Label: 'Reason' }
        ],

        FieldGroup #Reason: {
            Data: [
                { Value: code,            Label: 'Code' },
                { Value: description,     Label: 'Description' },
                { Value: credit_expected, Label: 'Credit usually expected' },
                { Value: valid_from,      Label: 'Valid from' },
                { Value: valid_to,        Label: 'Valid to' },
                { Value: is_active,       Label: 'Active' },
                { Value: notes,           Label: 'Notes' }
            ]
        }
    }
);

annotate DefuelConfigService.DefuelReasonCodes with {
    code            @title: 'Reason Code';
    description     @title: 'Description'
                    @Common.FieldControl: #Mandatory;
    credit_expected @title: 'Credit Usually Expected'
                    @Common.QuickInfo: 'Steers the default on the defuel screen and nothing else. It is not a rule: a fuel-quality defuel is sometimes credited in full and sometimes not at all, and a system that decided that from the reason would be wrong about half of them.';
    valid_from      @title: 'Valid From';
    valid_to        @title: 'Valid To';
    is_active       @title: 'Active';
    notes           @title: 'Notes';
}

// ===========================================================================
// G/L accounts — the screen Q8 asked for
// ===========================================================================
annotate DefuelConfigService.DefuelGlAccounts with @(
    UI: {
        SelectionFields: [ carrier_code, account_role, is_active ],

        LineItem: [
            { Value: account_role,  Label: 'Account role', ![@UI.Importance]: #High },
            { Value: gl_account,    Label: 'G/L account',  ![@UI.Importance]: #High },
            { Value: posting_key,   Label: 'Posting key',  ![@UI.Importance]: #High },
            { Value: carrier_code, Label: 'Carrier' },
            { Value: company_code,  Label: 'Company code' },
            { Value: description,   Label: 'Description' },
            { Value: valid_from,    Label: 'Valid from' },
            { Value: valid_to,      Label: 'Valid to' },
            { Value: is_active,     Label: 'Active' }
        ],

        HeaderInfo: {
            TypeName       : 'G/L Account',
            TypeNamePlural : 'Defuel G/L Accounts',
            Title          : { Value: account_role },
            Description    : { Value: gl_account }
        },

        Facets: [
            { $Type: 'UI.ReferenceFacet', ID: 'Account',
              Target: '@UI.FieldGroup#Account', Label: 'Account' }
        ],

        FieldGroup #Account: {
            Data: [
                { Value: account_role, Label: 'Account role' },
                { Value: gl_account,   Label: 'G/L account' },
                { Value: posting_key,  Label: 'Posting key' },
                { Value: carrier_code, Label: 'Carrier' },
                { Value: company_code, Label: 'Company code' },
                { Value: description,  Label: 'Description' },
                { Value: valid_from,   Label: 'Valid from' },
                { Value: valid_to,     Label: 'Valid to' },
                { Value: is_active,    Label: 'Active' }
            ]
        }
    }
);

annotate DefuelConfigService.DefuelGlAccounts with {
    account_role @title: 'Account Role'
                 @Common.FieldControl: #Mandatory
                 @Common.QuickInfo: 'What the account is for. The five ADJ_ roles are one per price component, because a defuel reverses an uplift cost and an uplift cost has parts — baseline, service fee, airport/royalty, into-plane and taxes.';

    gl_account   @title: 'G/L Account'
                 @Common.FieldControl: #Mandatory
                 @Common.QuickInfo: 'SAKNR as S/4 carries it — a string, because an account keeps its leading zeros in some charts of accounts and loses them in none.';

    posting_key  @title: 'Posting Key'
                 @Common.QuickInfo: 'Recorded and handed over. FuelSphere does not derive an account from it.';

    carrier_code @title: 'Carrier'
                 @Common.QuickInfo: 'Leave empty for a mapping that applies to every carrier.';

    company_code @title: 'Company Code';
    description  @title: 'Description';
    valid_from   @title: 'Valid From'
                 @Common.FieldControl: #Mandatory
                 @Common.QuickInfo: 'Effective-dated on purpose. An account renumbered in April must not retrospectively re-explain January.';
    valid_to     @title: 'Valid To';
    is_active    @title: 'Active';
}
