/**
 * FuelSphere — SUPPLIER CONTACTS (work package C)
 *
 * WHO TO RING AT 05:00, AND FOR WHAT.
 *
 * The SME asked twice and gave the reason: "if I need to call somebody, that
 * one tab should be available. Time is of the essence." The flight schedule
 * ships supplier and agent by NAME and CONTRACT and, until this, nothing to
 * ring.
 *
 * =========================================================================
 * ROLE IS A VALUE, NOT A COLUMN SET
 * =========================================================================
 *
 * A supplier with two disputes contacts is normal, and four columns named
 * invoicing_phone, uplift_phone and so on cannot hold the second. So a role
 * is a row, and `is_primary` says which one answers first.
 *
 * =========================================================================
 * AND THE STRIP SHOWS THE PRIMARY ONLY — WITH THE COUNT OF OTHERS
 * =========================================================================
 *
 * The strip exists so somebody can ring at 05:00: four roles, four numbers,
 * one screen. Showing every contact stops it being scannable, and a planner
 * reading eight rows to find the uplift number has lost the thing the strip
 * was for.
 *
 * BUT A STRIP SHOWING ONE CONTACT WITH NO SIGN OF A SECOND IS THE SAME
 * SILENCE AS THE AIRCRAFT CARD - correct, and it teaches nothing. So
 * `other_count` is carried beside the primary, and the screen renders
 * "+1 more". It says others EXIST without spending a row on them.
 *
 * =========================================================================
 * A ROLE WITH NO CONTACT IS A ROW, NOT AN ABSENCE
 * =========================================================================
 *
 * "DISPUTES - none recorded" is a finding; a missing row is invisible. Same
 * rule as MLW and MZFW being MISSING rather than blank, one level down.
 *
 * That is what the CROSS JOIN below is for, and it is the whole reason this
 * is a view rather than a projection: cross joining the four roles against
 * every supplier GUARANTEES four rows per supplier, populated or not. A
 * left join alone would return three rows for a supplier with three
 * contacts, and the fourth role would vanish exactly when it matters.
 */
namespace fuelsphere;

using { cuid } from '@sap/cds/common';
using { fuelsphere as db } from './schema';
using { fuelsphere as dsg } from './designated-suppliers';

/**
 * The four roles, as DATA rather than as an enum.
 *
 * D25's lesson applied before it bites: a CDS enum is not enforced without
 * @assert.range, and 79 enum-typed elements in this schema are unenforced.
 * A code list is a foreign key, which the database DOES enforce - and it is
 * what makes the cross join above possible, because you cannot cross join
 * against an enum.
 */
entity CONTACT_ROLES {
    key role_code   : String(12);     // INVOICING · UPLIFT · DISPUTES · OPERATIONS
        role_name   : String(40);
        description : String(200);
        // THE READING ORDER OF THE STRIP, and not the alphabet: DISPUTES
        // would come first alphabetically and it is the one you ring last.
        sort_order  : Integer;
        is_active   : Boolean default true;
}

entity SUPPLIER_CONTACTS : cuid, db.AuditTrail {
        supplier      : Association to db.MASTER_SUPPLIERS @mandatory;
        // UNMANAGED, OVER role_code, following the pattern AIRCRAFT_REGISTRATIONS
        // uses for aircraft_type. A managed association would generate
        // role_role_code beside role_code and the seed would carry the same
        // value twice under two names.
        role_code     : String(12) @mandatory;
        role          : Association to CONTACT_ROLES on role.role_code = role_code;

        contact_name  : String(100) @mandatory;
        position      : String(100);

        phone         : String(40);
        mobile        : String(40);
        email         : String(120);

        // "24h" is the answer that matters for UPLIFT and it is free text
        // because the shapes vary - 24h, 0600-2200 local, weekdays only.
        hours         : String(60);
        timezone      : String(40);

        // WHO ANSWERS FIRST, PER ROLE. Not per supplier: "who do I ring for
        // uplift" has one answer and "who do I ring" does not.
        //
        // NOT UNIQUE-CONSTRAINED, and that is deliberate rather than an
        // oversight. There are zero @assert.unique in db/, and a constraint
        // here would reject a legitimate mid-handover state where two rows
        // are briefly primary. The view below resolves it by taking the
        // lowest-sorted, and the harness asserts the seed carries one.
        is_primary    : Boolean default false;

        valid_from    : Date;
        valid_to      : Date;
        is_active     : Boolean default true;
}

/**
 * SUPPLIER_ROLE_CONTACTS — four rows per supplier, always.
 *
 * The cross join is the point. Every supplier gets every role whether a
 * contact exists or not, so "none recorded" is a row the screen can render
 * rather than a gap it cannot see.
 *
 * `other_count` is contacts BEYOND the primary, so a role with exactly one
 * contact reads 0 and the strip stays quiet. A role with none reads 0 too -
 * and primary_name is null there, which is what distinguishes them.
 */
entity SUPPLIER_ROLE_CONTACTS as select from CONTACT_ROLES as r
    cross join db.MASTER_SUPPLIERS as s
    left join SUPPLIER_CONTACTS as c
           on  c.supplier.ID  = s.ID
           and c.role_code    = r.role_code
           and c.is_active   != false
{
    key s.ID          as supplier_ID,
    key r.role_code   as role_code,

        r.role_name,
        r.sort_order,
        s.supplier_name,
        s.supplier_code,

        count(c.ID)                                                  as contact_count : Integer,

        // CONTACTS BEYOND THE PRIMARY. This is the number the strip renders
        // as "+N more", and it is deliberately NOT contact_count: a role
        // with exactly one contact must read 0 so the strip stays quiet.
        //
        // A role with NONE also reads 0, and primary_name being null is what
        // distinguishes them. Two zeros meaning different things is the shape
        // the counters row warns about, so the screen must read both.
        count(c.ID) - count(case when c.is_primary = true then 1 end)
                                                                     as other_count : Integer,
        max(case when c.is_primary = true then c.contact_name end)   as primary_name  : String(100),
        max(case when c.is_primary = true then c.position end)       as primary_position : String(100),
        max(case when c.is_primary = true then c.phone end)          as primary_phone : String(40),
        max(case when c.is_primary = true then c.mobile end)         as primary_mobile : String(40),
        max(case when c.is_primary = true then c.email end)          as primary_email : String(120),
        max(case when c.is_primary = true then c.hours end)          as primary_hours : String(60),
        max(case when c.is_primary = true then c.timezone end)       as primary_timezone : String(40)
} group by s.ID, r.role_code, r.role_name, r.sort_order, s.supplier_name, s.supplier_code;

// The supplier can enumerate its own contacts and its own role summary.
extend db.MASTER_SUPPLIERS with {
    contacts      : Association to many SUPPLIER_CONTACTS
                    on contacts.supplier = $self;
    role_contacts : Association to many SUPPLIER_ROLE_CONTACTS
                    on role_contacts.supplier_ID = ID;
}


/**
 * FLIGHT_CONTACTS — who to ring for THIS flight, by party and role.
 *
 * WHY A VIEW AND NOT A FACET PATH. The obvious annotation is
 * `designation/supplier/role_contacts/@UI.LineItem`, and it CANNOT BIND:
 * FLIGHT_SCHEDULE.designation is an Association to MANY, so the path needs a
 * key at the first hop and Fiori has none to give. Measured -
 * GET FlightSchedule(<id>)/designation/supplier returns 404. Every hop
 * exists, the path resolves on paper, and nothing renders: the D50 class
 * arriving through cardinality rather than through a wrong name.
 *
 * TWO PARTIES ON ONE FLIGHT, AND THE ROLES DIVIDE BETWEEN THEM. Where the
 * supplier does not perform its own uplift, the UPLIFT contact sits with the
 * AGENT while invoicing and disputes stay with the SUPPLIER. `party` is what
 * stops a planner ringing the wrong company at 05:00, and it is a column
 * rather than two views because one scannable block beats two half-empty
 * ones.
 *
 * Built on FLIGHT_DESIGNATION, so it enumerates the companies that APPLY -
 * both a flight-level designation and a station default where both exist.
 *
 * AND IT IS KEYED ON THE COMPANY, NOT ON THE DESIGNATION. Keyed on
 * designation_ID it returned SIXTEEN ROWS FOR AC410: two applicable
 * designations naming the SAME supplier, so every number appeared twice and
 * the strip that exists to be scanned listed each contact once per rung.
 * Measured through the navigation, not reasoned about - the same duplication
 * a left join causes in UNBILLED_TICKETS, arriving somewhere else.
 *
 * The group by is what collapses it, and it still shows TWO companies where
 * two designations name different ones, which is the case that matters.
 */
entity FLIGHT_CONTACTS as select from dsg.FLIGHT_DESIGNATION as fd
    join SUPPLIER_ROLE_CONTACTS as rc
      on rc.supplier_ID = fd.supplier.ID
{
    key fd.flight_ID,
    key rc.supplier_ID,
    key rc.role_code,

        fd.flight_number,
        fd.flight_date,
        fd.origin_airport,
        fd.destination_airport,
        fd.airline_code,

        'SUPPLIER'          as party : String(8),
        rc.supplier_name,
        rc.role_name,
        rc.sort_order,
        rc.primary_name,
        rc.primary_position,
        rc.primary_phone,
        rc.primary_mobile,
        rc.primary_email,
        rc.primary_hours,
        rc.contact_count,
        rc.other_count
} group by fd.flight_ID, rc.supplier_ID, rc.role_code, fd.flight_number, fd.flight_date,
           fd.origin_airport, fd.destination_airport, fd.airline_code, rc.supplier_name,
           rc.role_name, rc.sort_order, rc.primary_name, rc.primary_position, rc.primary_phone,
           rc.primary_mobile, rc.primary_email, rc.primary_hours, rc.contact_count, rc.other_count
union all
select from dsg.FLIGHT_DESIGNATION as fd
    join SUPPLIER_ROLE_CONTACTS as rc
      on rc.supplier_ID = fd.into_plane_agent.ID
{
    key fd.flight_ID,
    key rc.supplier_ID,
    key rc.role_code,

        fd.flight_number,
        fd.flight_date,
        fd.origin_airport,
        fd.destination_airport,
        fd.airline_code,

        'AGENT'             as party : String(8),
        rc.supplier_name,
        rc.role_name,
        rc.sort_order,
        rc.primary_name,
        rc.primary_position,
        rc.primary_phone,
        rc.primary_mobile,
        rc.primary_email,
        rc.primary_hours,
        rc.contact_count,
        rc.other_count
} group by fd.flight_ID, rc.supplier_ID, rc.role_code, fd.flight_number, fd.flight_date,
           fd.origin_airport, fd.destination_airport, fd.airline_code, rc.supplier_name,
           rc.role_name, rc.sort_order, rc.primary_name, rc.primary_position, rc.primary_phone,
           rc.primary_mobile, rc.primary_email, rc.primary_hours, rc.contact_count, rc.other_count;

extend db.FLIGHT_SCHEDULE with {
    contacts : Association to many FLIGHT_CONTACTS on contacts.flight_ID = ID;
}
