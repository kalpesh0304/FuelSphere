using { fuelsphere as db } from '../db/defuel';
using { fuelsphere as core } from '../db/schema';

/**
 * DefuelConfigService — the three things a defuel cannot run without.
 *
 * ===========================================================================
 * CONFIGURATION, NOT TRANSACTIONS. Storage locations, reason codes and the
 * G/L mapping are maintained by people before any defuel is recorded, and
 * they are maintained by DIFFERENT people: locations by operations, reasons
 * by whoever owns the fuel process, G/L accounts by finance. Putting them on
 * the transaction service would make a finance screen reachable from an
 * operations tile.
 *
 * ITS OWN SERVICE, FOLLOWING ValuationService's reasoning. A new entity in an
 * existing service is a new line in its metadata, a new annotation in its
 * file and a new way for its deploy to fail. Nothing here is reachable from
 * the ledger services, and nothing there is reachable from here.
 *
 * THIS IS WHAT Q8 ASKED FOR, in those words: "Create a screen to configure
 * G/L accounts and respective posting keys." The other two masters are here
 * because a G/L screen on its own would be the only configurable thing in a
 * feature whose locations and reasons are also configurable — R1.3 and R2.1
 * both say so.
 *
 * WRITEABLE, WHICH IS THE POINT. Everything else the defuel work exposes
 * will be derived and read-only; these three are typed in, and a screen that
 * cannot be typed into is not a configuration screen.
 * ===========================================================================
 */
@path: '/odata/v4/defuelconfig'
service DefuelConfigService {

    /**
     * STORAGE_LOCATION — somewhere for defuelled fuel to be.
     *
     * The type is the whole reason there are two: `DEFUEL` fuel is going back
     * to the vendor and must not be quietly re-uplifted, because the return
     * has already been priced and may already be accrued. `TEMP` fuel is
     * waiting for another aircraft. Same liquid, same tank, different
     * commercial situation — and R2.4 makes the difference a hard refusal.
     */
    entity StorageLocations as projection on db.STORAGE_LOCATION {
        *,
        airport : redirected to Airports,
        // THE IATA CODE, NAMED — and NOT airport_ID. The managed association
        // already generates airport_ID as its foreign key, so aliasing that
        // name is a conflict rather than a convenience. The code is what a
        // screen wants anyway: nobody reads a UUID off a list of locations.
        airport.iata_code as airport_iata : String(3)
    };

    /**
     * DEFUEL_REASON_CODE — configurable, because the reason drives the
     * settlement.
     *
     * R1.3 asks for configurable rather than fixed, and R1.2 says why it is
     * mandatory: an over-weight defuel is fuel the vendor delivered correctly
     * and will usually credit; a fuel-quality defuel may be the vendor's
     * fault entirely or the airline's problem entirely. It is the first thing
     * a controller looks at.
     */
    entity DefuelReasonCodes as projection on db.DEFUEL_REASON_CODE;

    /**
     * DEFUEL_GL_ACCOUNT — the mapping, maintained rather than derived.
     *
     * SEVEN ROLES, FROM AN ANSWER THAT SAID THREE. The list keyed by role
     * serves both readings and an eighth role needs no deployment.
     *
     * IT STARTS EMPTY, DELIBERATELY. Seeding plausible-looking account
     * numbers would be inventing financial master data, and an invented
     * account that reaches a posting is worse than a missing one — the
     * missing one stops the posting and asks a question. Finance fills this
     * in; until they do, the roles are visible and unconfigured.
     */
    entity DefuelGlAccounts as projection on db.DEFUEL_GL_ACCOUNT {
        *,
        carrier : redirected to Carriers,
        // Same reasoning as airport_ID above.
        carrier.carrier_code as carrier_code : String(3)
    };

    // ---- value helps, read-only -------------------------------------------
    @readonly entity Airports as projection on core.MASTER_AIRPORTS;
    @readonly entity Carriers as projection on core.CARRIER_MASTER;
}
