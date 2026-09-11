/**
 * FuelSphere — WHY AN ORDER DIFFERS FROM ITS PLAN
 *
 * A planner orders 3,000 where the plan says 2,881, because bowsers come in
 * round numbers. That is ordinary and must stay possible. But an order that
 * SILENTLY differs from its plan is a variance nobody sees, which is the
 * whole argument for capturing the reason.
 *
 * ---------------------------------------------------------------------------
 * THREE STATES, AND THE THIRD IS THE ONE THAT KEEPS THIS HONEST
 *
 *   plan figure present, quantity DIFFERS    reason MANDATORY
 *   plan figure present, quantity MATCHES    no reason, and none asked for
 *   plan figure ABSENT                       NO REASON FIELD AT ALL
 *
 * NOT "prompted". A prompt is a field people learn to skip, and a skipped
 * prompt leaves exactly the silent variance this exists to prevent.
 *
 * The third state is not a convenience. D57 leaves `required_uplift_kg` null
 * on SEVEN of eleven plans — where there is no plan figure there is nothing
 * to differ FROM, and demanding a reason there would invent a comparison that
 * does not exist. An absent field is the honest answer.
 *
 * ---------------------------------------------------------------------------
 * THE SHAPE IS BORROWED, NOT INVENTED
 *
 * `crew_adjusted_quantity` / `crew_adjustment_reason` already stand on this
 * entity: a changed figure beside the reason it changed. Inventing a
 * different shape for the same idea is how two conventions start.
 *
 * NAMED FOR THE COMPARISON, NOT THE ACTOR. The crew pair is named for who
 * adjusted. This pair is about a PLAN, and the actor is whoever raised the
 * order — so the plan figure and the variance are what the names carry.
 *
 * AND THE MANDATORY-UNLESS RULE IS A CONVENTION HERE, NOT A CHOICE.
 * `cancel` already refuses without a reason unless the order is Draft
 * (`order-service.js`, the cancel handler). Same shape, same file: a state
 * change that loses information requires the information that explains it.
 */
namespace fuelsphere;

using { fuelsphere as db } from './schema';

extend db.FUEL_ORDERS with {

    // The plan figure this order was raised against, COPIED AT CREATION.
    //
    // A copy rather than a resolution, and deliberately: the plan can be
    // superseded (DSP453 replaces the active row) and the order must keep the
    // figure it was actually compared against. Resolving it live would make
    // the recorded reason explain a comparison that no longer exists.
    //
    // Null where the plan carried none - see the third state above.
    planned_quantity_kg      : Decimal(12,2);

    // Why the ordered quantity differs from planned_quantity_kg.
    //
    // String(500) matching crew_adjustment_reason and cancelled_reason, so
    // the three read alike. Enforced in the handler, not by @mandatory: a
    // CDS assertion cannot express "required only when two figures differ",
    // and @mandatory would demand one on every order including the matching
    // and the planless ones.
    quantity_variance_reason : String(500);
}
