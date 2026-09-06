/**
 * FuelSphere — extensions for work package D
 *
 * `extend` rather than editing schema.cds, for the same reason
 * designated-suppliers.cds is its own file: the entity is 5,462 lines away
 * and these four additions belong to D, not to the entity's original design.
 *
 * CAP merges these into the base entity, so the emitted EDMX is identical to
 * having typed them inline. Nothing here is a new object for an existing fact.
 */
namespace fuelsphere;

using { fuelsphere as db } from './schema';

/**
 * MASTER_SUPPLIERS — the agent is the SAME ENTITY, not a new one.
 *
 * S/4 models an into-plane agent as partner role WL with the supplier
 * remaining LF. One entity, supplier_type = AGENT, parent_supplier set where
 * the agent bills through the supplier rather than directly.
 *
 * NOTE ON supplier_type. It is String(20) with a comment reading
 * "EXTERNAL / INTO_PLANE", not an enum — so widening its documented domain to
 * include AGENT, TRADER and REFINER costs nothing and enforces nothing. That
 * is D25's general case (79 enum-typed elements, 0 enforced) arriving as the
 * absence of an enum rather than an unenforced one. Making it an enum with
 * @assert.range is a separate decision with a seed implication: all ten
 * existing rows read EXTERNAL, which would have to stay a member.
 */
extend db.MASTER_SUPPLIERS with {
    iata_code       : String(3);      // Two-character IATA fuel code where the supplier has one
    icao_code       : String(4);
    parent_supplier : Association to db.MASTER_SUPPLIERS;   // An agent billing through a supplier
}

/**
 * FUEL_ORDERS — the two columns the 1 September brief said were not needed.
 *
 * Its section 7 states "FUEL_ORDERS - no schema change. The supplier and agent
 * default from the designation at creation, into fields that already exist."
 * MEASURED: the order carries `supplier` and `contract` and has NO
 * into_plane_agent and NO second contract. The agent cannot default into a
 * field that does not exist.
 *
 * Both nullable. supplier_performs_uplift = TRUE on the designation means the
 * supplier fuels its own product and these stay empty, which is a different
 * state from "we do not know yet" and must not be conflated with it.
 *
 * DEFAULTED AT CREATION, NOT RESOLVED ON READ. The designation can change
 * after an order is placed, and the order must keep the agent it was actually
 * placed with. That is the opposite of the flight screen's rule — a flight
 * RESOLVES its supplier so a changed number shows everywhere, and an order
 * COPIES it so history survives. Both are right for what they are.
 */
extend db.FUEL_ORDERS with {
    into_plane_agent    : Association to db.MASTER_SUPPLIERS;
    into_plane_contract : Association to db.MASTER_CONTRACTS;
}
