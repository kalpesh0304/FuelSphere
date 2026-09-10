/**
 * FuelSphere — the tail master's performance characteristics (work package B)
 *
 * MTOW, MLW, MZFW and engine burn rate, per tail.
 *
 * `extend` from its own file rather than editing schema.cds, for the reason
 * designated-suppliers.cds and supplier-agent-extensions.cds do the same: the
 * entity is thousands of lines away and these belong to B, not to the
 * registration's original design. CAP merges them into the base entity, so
 * the emitted EDMX is identical to having typed them inline.
 *
 * =========================================================================
 * THREE OF THE FOUR ARE GENUINELY NEW. MTOW IS AN OVERRIDE.
 * =========================================================================
 *
 * mtow_kg ALREADY EXISTS on AIRCRAFT_MASTER — the TYPE — and is populated on
 * all 17 types. So every A320 reports 78,000 and every A223 the same figure
 * as its siblings. That is a sound planning approximation and a wrong
 * per-tail fact: a weight variant or a modification changes MTOW on one
 * airframe and not the others.
 *
 * ADDING IT HERE IS AN OVERRIDE, NOT A COPY, and it follows the pattern this
 * entity already uses one line above — fuel_capacity_kg carries the comment
 * "Overrides the type value where tanks differ". NULL means the type's figure
 * governs. That is what stops this being a second place holding one fact:
 * two values can only disagree if both are set, and a null cannot disagree
 * with anything.
 *
 * FLIGHT_AIRCRAFT resolves the pair with coalesce, so one expression decides
 * which wins and no reader has to know there are two.
 *
 * =========================================================================
 * AND THEY ARE NULL ON ALL 31 ROWS, DELIBERATELY
 * =========================================================================
 *
 * There is no source in this repository for MLW, MZFW or an engine burn rate
 * — that is the research half of work package B, and the register's own
 * history says why it matters: the August 2026 schedule brought nine APU
 * rates for three types with no precedent, and the existing rates could not
 * be extrapolated from because published figures gave no consistent ratio.
 * Inventing a landing weight would be the same error with more zeros.
 *
 * So the columns exist, the data does not, and NOTHING PUTS THEM ON A SCREEN
 * WHERE THEY WOULD RENDER AS THREE BLANK ROWS. A field that is not there is
 * a question; a blank one is the eighth cause of an empty section. They go on
 * the tail master's own page — where a master-data screen legitimately shows
 * an empty field to be filled — and NOT on the flight overview's Aircraft
 * card until something populates them.
 */
namespace fuelsphere;

using { fuelsphere as db } from './schema';

extend db.AIRCRAFT_REGISTRATIONS with {

    // OVERRIDE. Null means the type's mtow_kg governs — see AIRCRAFT_MASTER.
    // Set only where this airframe differs from its type, and the reason
    // belongs in a note when it is.
    mtow_kg               : Decimal(15,2);

    // MAXIMUM LANDING WEIGHT. Genuinely per tail and nowhere in the model
    // before this. It constrains the arrival, not the departure: a flight
    // can be legal at MTOW and illegal to land without burning down to MLW,
    // which is why it cannot be derived from MTOW by any ratio.
    mlw_kg                : Decimal(15,2);

    // MAXIMUM ZERO FUEL WEIGHT. The structural limit on payload plus empty
    // weight, before any fuel. FLIGHT_DISPATCH.payload_plan_kg already
    // carries the comment "capped by MZFW" — a constraint the model could
    // not express until now, because the figure it names did not exist.
    mzfw_kg               : Decimal(15,2);

    // ENGINE BURN RATE, per tail and per hour.
    //
    // NOT cruise_burn_kgph, which is on the TYPE and is one figure for every
    // airframe of that model. The SME asked for a per-tail rate because it
    // DRIFTS WITH AGE and airlines re-baseline it — which is the same reason
    // performance_factor_pct is per tail rather than per type.
    engine_burn_rate_kgph : Decimal(10,2);
}
