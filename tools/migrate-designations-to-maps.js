#!/usr/bin/env node
/**
 * FuelSphere - DESIGNATED_SUPPLIERS into the two maps.
 *
 * WHY, decided 2 Oct 2026. Two tables answered "who fuels this flight".
 * DESIGNATED_SUPPLIERS resolved it for the flight screens; STATION_SUPPLIER_MAP
 * and FLIGHT_SUPPLIER_MAP resolved it for the S/4 posting, and CAR405 could
 * only REPORT when the two disagreed. One question, one place: the maps keep
 * it, because they already carry the posting coordinates - plant, contract,
 * line item - that the designation never had, and four apps are built on them.
 *
 * WHAT MOVES, from the 228 rows:
 *
 *   79 station-level rows (no flight number) -> STATION_SUPPLIER_MAP,
 *      is_default = true. These were the station's default supplier.
 *
 *  149 flight-level rows -> FLIGHT_SUPPLIER_MAP. These were the exceptions,
 *      and stay exceptions.
 *
 *    7 extra STATION_SUPPLIER_MAP rows, is_default = false. CAR410 requires a
 *      flight-level supplier to be mapped at its station, and 148 of the 149
 *      flight rows name a supplier the station had no row for - correctly, as
 *      it happens: a flight-level arrangement is precisely the case where the
 *      station default is somebody else. Coverage without a default is what
 *      is_default = false means, and these seven rows are why it exists.
 *
 * TWO THINGS THE DESIGNATIONS DO NOT CARRY, and both are stated rather than
 * invented:
 *
 *   contract_line_item is @mandatory on the station map and has no source in
 *   DESIGNATED_SUPPLIERS. Every migrated row gets '10', the first line, and
 *   says so in its notes. It is the only honest default: a contract's first
 *   line is where a single-product fuel agreement sits, and a wrong line is
 *   visible on screen and correctable, where a blank would block the posting.
 *
 *   CARRIER_MASTER has B6 and B7; five designation rows name AC. The carrier
 *   is @mandatory on both maps, so AC is added to the master as part of this
 *   migration rather than those five rows being dropped.
 *
 * IDs ARE DETERMINISTIC - uuid5 over the source row's own ID - so re-running
 * this produces the same rows rather than duplicates, and a migrated row can
 * always be traced back to the designation it came from.
 *
 * Run:  node tools/migrate-designations-to-maps.js [--write]
 * Without --write it reports what it would produce and changes nothing.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT = path.resolve(__dirname, '..');
const DATA = path.join(PROJECT, 'db', 'data');
const WRITE = process.argv.includes('--write');

const STAMP = '2026-10-04T00:00:00Z';
const BY = 'MIGRATION_DESIGNATIONS';
const DEFAULT_LINE = '10';

// ---- csv ------------------------------------------------------------------
//
// A MISSING FILE IS NOT AN ERROR. The two maps have entities and apps but have
// never been seeded, so their CSVs do not exist yet and this migration is what
// creates them. Their columns then come from the MODEL rather than from a
// hand-written list - the names CAP generates for the foreign keys
// (airport_ID, carrier_carrier_code) are not guessable, and a list that drifts
// from the model writes a file the deployer imports into the wrong columns.
const read = (name, modelCols) => {
    const file = path.join(DATA, `fuelsphere-${name}.csv`);
    if (!fs.existsSync(file)) {
        if (!modelCols) throw new Error(`${name}: no CSV and no columns from the model`);
        return { cols: modelCols, rows: [], fresh: true };
    }
    const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const cols = lines[0].split(';');
    return {
        cols,
        rows: lines.slice(1).map(l => {
            const f = l.split(';');
            return Object.fromEntries(cols.map((c, i) => [c, (f[i] ?? '').trim()]));
        })
    };
};

/** The stored columns of an entity, in the model's own order. */
async function columnsOf(names) {
    const cds = require(path.join(PROJECT, 'node_modules', '@sap', 'cds'));
    process.env.CDS_ENV = process.env.CDS_ENV || 'development';
    const compiled = cds.compile.for.nodejs(await cds.load('*'));
    const out = {};
    for (const n of names) {
        const d = compiled.definitions[n];
        if (!d) throw new Error(`${n} is not in the model`);
        out[n] = Object.entries(d.elements)
            .filter(([, e]) => !e.isAssociation && !e.virtual).map(([k]) => k);
    }
    return out;
}
const write = (name, cols, rows) => {
    const lines = [cols.join(';')];
    for (const r of rows) lines.push(cols.map(c => r[c] ?? '').join(';'));
    fs.writeFileSync(path.join(DATA, `fuelsphere-${name}.csv`), lines.join('\r\n') + '\r\n', 'utf8');
    console.log(`  wrote ${rows.length} rows to fuelsphere-${name}.csv`);
};

/** uuid5, so the same source row always produces the same map row. */
const NS = '1b671a64-40d5-491e-99b0-da01ff1f3341';
function uuid5(name) {
    const nsBytes = Buffer.from(NS.replace(/-/g, ''), 'hex');
    const h = crypto.createHash('sha1').update(Buffer.concat([nsBytes, Buffer.from(name)])).digest();
    h[6] = (h[6] & 0x0f) | 0x50;
    h[8] = (h[8] & 0x3f) | 0x80;
    const x = h.subarray(0, 16).toString('hex');
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

(async function main() {
    const modelCols = await columnsOf(['fuelsphere.STATION_SUPPLIER_MAP',
                                       'fuelsphere.FLIGHT_SUPPLIER_MAP']);
    const des = read('DESIGNATED_SUPPLIERS');
    const air = read('MASTER_AIRPORTS');
    const car = read('CARRIER_MASTER');
    const sta = read('STATION_SUPPLIER_MAP', modelCols['fuelsphere.STATION_SUPPLIER_MAP']);
    const fli = read('FLIGHT_SUPPLIER_MAP', modelCols['fuelsphere.FLIGHT_SUPPLIER_MAP']);

    const airportByIata = new Map(air.rows.filter(a => a.iata_code).map(a => [a.iata_code, a.ID]));
    const carriers = new Set(car.rows.map(c => c.carrier_code));

    const active = des.rows.filter(d => d.is_active !== 'false');
    const station = active.filter(d => !d.flight_number);
    const flight = active.filter(d => d.flight_number);
    console.log(`${des.rows.length} designation(s): ${station.length} station-level, `
              + `${flight.length} flight-level, ${des.rows.length - active.length} inactive`);

    // ---- the carriers the designations name ------------------------------
    const named = [...new Set(active.map(d => d.carrier_code).filter(Boolean))];
    const missing = named.filter(c => !carriers.has(c));
    if (missing.length) {
        console.log(`carrier(s) absent from CARRIER_MASTER and added: ${missing.join(', ')}`);
    }
    const carrierRows = car.rows.slice();
    for (const code of missing) {
        const row = Object.fromEntries(car.cols.map(c => [c, '']));
        Object.assign(row, {
            carrier_code: code,
            carrier_name: code === 'AC' ? 'Air Canada' : code,
            // THE COMPANY CODE IS A GUESS AND IS MARKED AS ONE. It drives
            // which books the S/4 documents post under, so a wrong value is
            // worse than an obvious placeholder somebody must correct.
            company_code: `${code}00`,
            is_active: 'true',
            notes: 'Added by the designation migration (4 Oct 2026). COMPANY CODE IS A '
                 + 'PLACEHOLDER - set it before any posting is raised for this carrier.',
            created_at: STAMP, created_by: BY, modified_at: STAMP, modified_by: BY
        });
        carrierRows.push(row);
    }

    // ---- station rows -----------------------------------------------------
    const stationRows = [];
    const seen = new Set();
    const problems = [];

    const stationRow = (d, isDefault, why) => {
        const airportId = airportByIata.get(d.station_code);
        if (!airportId) { problems.push(`${d.station_code}: no airport`); return null; }
        const key = `${d.station_code}|${d.carrier_code}|${d.supplier_ID}`;
        if (seen.has(key)) return null;
        seen.add(key);
        const row = Object.fromEntries(sta.cols.map(c => [c, '']));
        Object.assign(row, {
            ID: uuid5('STATION_SUPPLIER_MAP:' + key),
            airport_ID: airportId,
            carrier_carrier_code: d.carrier_code,
            supplier_ID: d.supplier_ID,
            contract_ID: d.supplier_contract_ID,
            contract_line_item: DEFAULT_LINE,
            is_default: isDefault ? 'true' : 'false',
            supplier_performs_uplift: d.supplier_performs_uplift || 'false',
            into_plane_agent_ID: d.into_plane_agent_ID || '',
            into_plane_contract_ID: d.into_plane_contract_ID || '',
            valid_from: d.valid_from,
            valid_to: d.valid_to || '',
            is_active: 'true',
            notes: why,
            created_at: STAMP, created_by: BY, modified_at: STAMP, modified_by: BY
        });
        return row;
    };

    for (const d of station) {
        const r = stationRow(d, true,
            `Migrated from the station designation (4 Oct 2026). Contract line ${DEFAULT_LINE} `
          + 'assumed - the designation carried none. Verify against the contract.');
        if (r) stationRows.push(r);
    }

    // Coverage for every flight-level supplier, so CAR410 holds.
    let coverage = 0;
    for (const d of flight) {
        const r = stationRow(d, false,
            `Coverage row, migrated 4 Oct 2026 so the flight-level mapping for ${d.flight_number} `
          + `resolves a contract line at ${d.station_code}. NOT the station default. Contract line `
          + `${DEFAULT_LINE} assumed.`);
        if (r) { stationRows.push(r); coverage++; }
    }

    // ---- flight rows ------------------------------------------------------
    const flightRows = [];
    for (const d of flight) {
        const airportId = airportByIata.get(d.station_code);
        if (!airportId) { problems.push(`${d.station_code}: no airport`); continue; }
        const row = Object.fromEntries(fli.cols.map(c => [c, '']));
        Object.assign(row, {
            ID: uuid5('FLIGHT_SUPPLIER_MAP:' + d.ID),
            flight_number: d.flight_number,
            airport_ID: airportId,
            carrier_carrier_code: d.carrier_code,
            supplier_ID: d.supplier_ID,
            // CARRIED, NOT DROPPED. 148 of these rows set
            // supplier_performs_uplift and one names its own into-plane agent;
            // a flight-level row overrides the station's arrangement whole.
            supplier_performs_uplift: d.supplier_performs_uplift || 'false',
            into_plane_agent_ID: d.into_plane_agent_ID || '',
            into_plane_contract_ID: d.into_plane_contract_ID || '',
            valid_from: d.valid_from,
            valid_to: d.valid_to || '',
            is_active: 'true',
            notes: 'Migrated from the flight-level designation (4 Oct 2026).',
            created_at: STAMP, created_by: BY, modified_at: STAMP, modified_by: BY
        });
        flightRows.push(row);
    }

    console.log(`\nwould produce:`);
    console.log(`  STATION_SUPPLIER_MAP  ${stationRows.length} `
              + `(${stationRows.length - coverage} default, ${coverage} coverage-only)`);
    console.log(`  FLIGHT_SUPPLIER_MAP   ${flightRows.length}`);
    console.log(`  CARRIER_MASTER        ${carrierRows.length} (was ${car.rows.length})`);
    const withAgent = stationRows.filter(r => r.into_plane_agent_ID).length
                    + flightRows.filter(r => r.into_plane_agent_ID).length;
    const withUplift = stationRows.filter(r => r.supplier_performs_uplift === 'true').length
                     + flightRows.filter(r => r.supplier_performs_uplift === 'true').length;
    console.log(`  into-plane agents carried over: ${withAgent}`);
    console.log(`  supplier-fuels-own-product flags carried: ${withUplift}`);
    if (problems.length) {
        console.log(`\n${problems.length} problem(s):`);
        for (const p of [...new Set(problems)].slice(0, 10)) console.log('  ' + p);
    }
    if (sta.rows.length || fli.rows.length) {
        console.log(`\nNOTE: the maps already hold ${sta.rows.length} station and `
                  + `${fli.rows.length} flight row(s); these are REPLACED.`);
    }

    if (!WRITE) {
        console.log('\nDRY RUN - nothing written. Re-run with --write.');
        return;
    }
    console.log('');
    write('CARRIER_MASTER', car.cols, carrierRows);
    write('STATION_SUPPLIER_MAP', sta.cols, stationRows);
    write('FLIGHT_SUPPLIER_MAP', fli.cols, flightRows);
})().catch(e => { console.error(e.message); process.exit(1); });
