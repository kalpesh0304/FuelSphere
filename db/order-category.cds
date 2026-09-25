namespace fuelsphere;

using { fuelsphere as db } from './schema';

/**
 * WHETHER THIS ORDER IS THE FLIGHT'S PLANNED UPLIFT OR AN EXTRA ONE.
 *
 * PLANNED is the order raised from the dispatch plan; SUPPLEMENTARY is fuel
 * ordered on top of it - a second bowser, a top-up after a delay, a change
 * the plan did not carry.
 *
 * SEPARATE FROM order_type, which is already on this entity and answers a
 * different question: whether an order is ORIGINAL or amends, increments or
 * tankers against another (db/order-plan-variance.cds). One says what this
 * order IS to the plan, the other what it is to the ORDERS around it, and the
 * manual-creation action already depends on the second.
 *
 * Backed by a code list rather than a bare enum so the field shows a picker:
 * a CDS enum compiles to a plain string and renders as a free-text box.
 */
entity ORDER_CATEGORY {
    key code : String(15);
        name : String(40);
}

extend db.FUEL_ORDERS with {
    order_category : String(15) default 'PLANNED';
}
