#!/usr/bin/env node
/**
 * Delete what has passed its seven days, in every configured store.
 *
 * Runs at the end of the daily job, and on its own if a day was missed. The
 * thumbnail and the record are never touched — that is the residue.
 */

import { openStores } from '../lib/store.ts';

let total = 0;
for (const store of openStores()) {
  const expired = await store.expire();
  total += expired.length;
  console.log(
    expired.length > 0
      ? `${store.name}: expired ${expired.length} (${expired.join(', ')})`
      : `${store.name}: nothing to expire`,
  );
}
process.exit(total > 0 ? 0 : 0);
