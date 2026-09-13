/**
 * tests/repair-orphaned-ledger.js
 *
 * REPAIR TOOL — ledger entries reserved or settled against a Payout that no
 * longer exists.
 *
 * WHY THIS CAN HAPPEN
 * -------------------
 * `settlement.createPayout` reserves ledger entries by stamping `payout` on them,
 * and `finalisePaid` marks them `settled`. If the Payout document is later deleted
 * (a test cleaning up after itself is the usual culprit), those entries are left
 * `settled` while pointing at nothing: the vendor's money has disappeared from
 * their available balance even though no payout ever happened.
 *
 * THE RULE (general — not hardcoded to any id)
 * -------------------------------------------
 * An entry that references a payout with no Payout document behind it was never
 * actually paid out, so it goes back into the pool:
 *
 *     status    -> 'available'
 *     payout    -> null
 *     settledAt -> unset
 *
 * The root cause is fixed separately: `createPayout` now accepts an `entryIds`
 * filter so a caller pays out exactly what it means to, and the test suites scope
 * their payouts to their own entries. This tool is the safety net for data that
 * was already damaged.
 *
 * SAFETY
 * ------
 *   - DRY RUN BY DEFAULT. Nothing is written without `--apply`.
 *   - Only touches entries whose payout reference is provably missing.
 *
 * USAGE
 * -----
 *   node tests/repair-orphaned-ledger.js            # preview
 *   node tests/repair-orphaned-ledger.js --apply    # repair
 */
require('dotenv').config();
// This machine's stub resolver cannot resolve the Atlas SRV record; point node at
// public resolvers (same workaround as the other suites).
require('dns').setServers(['1.1.1.1', '8.8.8.8']);
const mongoose = require('mongoose');
const connectDB = require('../src/config/database');
const { VendorLedger, Payout } = require('../src/models');
const settlement = require('../src/services/settlement.service');

const APPLY = process.argv.includes('--apply');
const money = (v) =>
  `Rs ${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

(async () => {
  let exitCode = 0;
  try {
    await connectDB();

    const candidates = await VendorLedger.find({
      payout: { $ne: null },
      status: { $in: ['settled', 'available'] },
    }).lean();

    console.log('');
    console.log('=== repair orphaned ledger entries ===');
    console.log(`mode                          : ${APPLY ? 'APPLY' : 'DRY RUN (nothing will be written)'}`);
    console.log(`entries referencing a payout  : ${candidates.length}`);

    const orphans = [];
    for (const row of candidates) {
      const exists = await Payout.exists({ _id: row.payout });
      if (!exists) orphans.push(row);
    }

    console.log(`of those, orphans (payout gone): ${orphans.length}`);
    console.log(`orphan value                  : ${money(orphans.reduce((sum, row) => sum + row.amount, 0))}`);

    const byType = {};
    for (const row of orphans) byType[row.type] = (byType[row.type] || 0) + 1;
    console.log(`orphans by type               : ${JSON.stringify(byType)}`);

    for (const row of orphans.slice(0, 5)) {
      console.log(
        `  sample: type=${row.type} amount=${row.amount} status=${row.status} ` +
          `payout=${String(row.payout)} settledAt=${row.settledAt ? row.settledAt.toISOString() : '-'}`,
      );
    }

    if (orphans.length === 0) {
      console.log('');
      console.log('Nothing to repair.');
      return;
    }

    if (!APPLY) {
      console.log('');
      console.log('DRY RUN complete. Re-run with --apply to restore these entries.');
      return;
    }

    const restored = await VendorLedger.updateMany(
      { _id: { $in: orphans.map((row) => row._id) } },
      { $set: { status: 'available', payout: null }, $unset: { settledAt: '' } },
    );
    console.log('');
    console.log(`restored to available         : ${restored.modifiedCount ?? restored.nModified}`);

    // Verify by asking the service the same questions the API asks.
    const vendorId = orphans[0]?.vendor;
    if (vendorId) {
      const summary = await settlement.getVendorLedgerSummary(String(vendorId));
      console.log(`vendor available balance      : ${money(summary.availableBalance)}`);
      console.log(`vendor reserved balance       : ${money(summary.reservedBalance)}`);

      const overview = await settlement.getPayoutOverview();
      console.log(`platform totalAvailable       : ${money(overview.totalAvailable)}`);

      const vendors = await settlement.getVendorsWithBalances({ page: 1, limit: 100 });
      console.log(`vendors with balances         : ${vendors.pagination.total}`);
      for (const row of vendors.vendors.slice(0, 5)) {
        console.log(
          `  ${row.businessName}  available=${money(row.availableBalance)}  ` +
            `pending=${money(row.pendingBalance)}  reserved=${money(row.reservedBalance)}  isPayable=${row.isPayable}`,
        );
      }
    }
    console.log('');
    console.log('Repair complete.');
  } catch (error) {
    exitCode = 1;
    console.error('REPAIR FAILED:', error.message);
  } finally {
    await mongoose.connection.close().catch(() => {});
    process.exit(exitCode);
  }
})();
