namespace fuelsphere;

using { cuid } from '@sap/cds/common';
using { fuelsphere as db } from './schema';

/**
 * IDR_RULE_STATUS — ONE ROW PER DOCUMENT PER APPLICABLE RULE.
 *
 * =========================================================================
 * WHY A JOIN COULD NOT DO THIS
 * =========================================================================
 *
 * The obvious build is to join INVOICE_CHECK_REGISTRY to INVOICE_EXCEPTIONS
 * and show PASSED where no exception exists. That is a rendering trick and
 * it fails three ways:
 *
 *   it cannot distinguish PASSED from NOT_APPLICABLE
 *   it cannot say WHEN a rule passed
 *   it cannot survive the registry changing
 *
 * The third is the one that bites quietly: a rule added tomorrow would
 * appear as PASSED on every historical document, because ABSENCE IS NOT
 * EVIDENCE. Nothing ran, and the screen would say it passed.
 *
 * The first is the one that matters most today, and the resolution cascade
 * is why. A line with no ticket number fails INV450 — and INV462, INV463,
 * INV464 and INV466 then HAVE NOTHING TO EVALUATE. Join-by-absence renders
 * those four green. They are not green. They never ran.
 *
 * =========================================================================
 * WHAT THIS IS NOT
 * =========================================================================
 *
 * It is not a second copy of INVOICE_EXCEPTIONS. An exception carries the
 * EVIDENCE of a failure — observed, expected, the rung, the tolerance row
 * that supplied the threshold — and it has a lifecycle a person acts on.
 * This carries the VERDICT OF A RUN, for every rule, including the ones
 * that produced nothing. A FAILED row here points AT the exception rather
 * than restating it.
 *
 * =========================================================================
 * IDR_ AND NOT INVOICE_, AGAINST AN ENTITY STILL CALLED INVOICES
 * =========================================================================
 *
 * IDR_Schema_Proposal.md §6 leaves three things open, and the first is
 * whether INVOICES is renamed to IDR_HEADER or a header sits above it.
 * THAT IS NOT DECIDED AND IS NOT DECIDED HERE. The name says which design
 * this entity belongs to; the association says what holds a document today.
 * When §6 is answered, this association moves and nothing else does.
 */
entity IDR_RULE_STATUS : cuid {
        invoice         : Association to db.INVOICES @mandatory;

        // The registry row, by association AND by code.
        //
        // Both, deliberately, and for the reason INVOICE_EXCEPTION_BYPASSES
        // denormalises check_code: the registry row may be re-dated,
        // re-scoped or deactivated later, and a verdict recorded under a
        // code must still read as that code afterwards.
        rule            : Association to db.INVOICE_CHECK_REGISTRY;
        check_code      : String(20) @mandatory;
        check_group     : String(30);

        // Null for a header rule. A verdict about the document as a whole
        // belongs to no line — the same rule INVOICE_EXCEPTIONS follows.
        invoice_item    : Association to db.INVOICE_ITEMS;
        line_number     : Integer;

        status          : RuleStatus @mandatory;

        // AS RESOLVED, which may differ from the registry default where a
        // tolerance ladder decided. Null on a rule that did not fail —
        // severity is a property of a finding, not of a rule that passed.
        severity        : db.CheckSeverity;
        severity_source : String(30);           // REGISTRY_DEFAULT | TOLERANCE_LADDER

        // WHY IT DID NOT APPLY, in the terms of this document.
        //
        // MANDATORY IN PRACTICE ON NOT_APPLICABLE and enforced by the
        // handler. A NOT_APPLICABLE with no reason is indistinguishable
        // from a rule nobody bothered to record, which is the state this
        // entity exists to end.
        na_reason       : String(300);

        // The finding, where there was one. NOT a copy of it.
        exception       : Association to db.INVOICE_EXCEPTIONS;
        message         : String(500);          // The one-line verdict, for reading without a join

        evaluated_at    : DateTime @mandatory;
        evaluated_by    : String(100);

        // Bypass is recorded on the exception and its own bypass entity.
        // Reflected here so the rule table reads as one surface — a clerk
        // scanning twenty-two rows should not have to join to learn that
        // one of the reds was released.
        bypassed_by     : String(100);
        bypassed_at     : DateTime;
        bypass_reason   : String(500);
}

/**
 * The four verdicts.
 *
 * NOT_APPLICABLE is the member that justifies the entity. Without it the
 * only honest alternative is silence, and silence reads as PASSED.
 */
type RuleStatus : String(20) enum {
    Passed          = 'PASSED';           // Ran and cleared
    Failed          = 'FAILED';           // Raised, open
    Bypassed        = 'BYPASSED';         // Raised, released by a person with a reason
    NotApplicable   = 'NOT_APPLICABLE';   // DID NOT APPLY to this document
}

/**
 * THE FIVE COUNTERS — and the point is that they SUM.
 *
 * The three that exist (open_hard_count, open_soft_count, warning_count)
 * count OPEN EXCEPTIONS. These count RULES EVALUATED. They are different
 * questions and neither answers the other:
 *
 *   open_hard_count = 2   says two hard errors are open
 *   rules_failed    = 2   says the same thing from the other side
 *   rules_passed    = 9   HAS NO COUNTERPART TODAY, because a rule that
 *                         passed leaves no row anywhere
 *   rules_not_applicable = 11
 *                         has no counterpart either, and is the number a
 *                         join-by-absence would have shown as passed
 *
 * rules_evaluated is the total written for this run, and
 *
 *     rules_evaluated = passed + failed + bypassed + not_applicable
 *
 * MUST hold. It is asserted, and it is the criterion that keeps the
 * counters honest: a rule the runner forgets to record shows up as an
 * arithmetic failure rather than as a screen that quietly under-reports.
 *
 * They live on INVOICES rather than being counted on read because the
 * screen that needs them is a LIST — twenty-two sub-queries per row is not
 * a dashboard, and $filter cannot reach a count computed after READ.
 */
extend db.INVOICES with {
    rules_evaluated      : Integer;
    rules_passed         : Integer;
    rules_failed         : Integer;
    rules_bypassed       : Integer;
    rules_not_applicable : Integer;

    // COMPOSITION, AND THE RE-KEYING COST IS ALREADY PAID ON THIS ENTITY.
    //
    // INVOICES is @odata.draft.enabled, so a composition child joins the
    // draft tree and its key becomes (ID, IsActiveEntity). That is the
    // recorded trap, and it was MEASURED here rather than reasoned about:
    //
    //   InvoiceExceptions        key = [ID, IsActiveEntity]
    //   InvoiceItems             key = [ID, IsActiveEntity]
    //   InvoiceExceptionBypasses key = [ID]          <- association child
    //
    //   GET InvoiceExceptions(<uuid>)                      -> 400
    //   GET InvoiceExceptions(ID=<uuid>,IsActiveEntity=true) -> 200
    //
    // Every composition child of INVOICES already behaves this way, so
    // Composition is the CONSISTENT choice here rather than a new cost.
    // It is also the right one: a rule status is the verdict of a run on
    // one document and has no life without it, which is exactly what
    // MARKET_INDEX_VALUES did NOT have and why that one is an Association.
    //
    // The consequence to know: no bound action and no direct address by
    // bare ID. The screen reaches these through the navigation.
    rule_statuses        : Composition of many IDR_RULE_STATUS
                           on rule_statuses.invoice = $self;
}
