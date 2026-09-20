#!/usr/bin/env node
/**
 * Print the day an emission belongs to.
 *
 * The workflow needs this before it runs anything, so that the emission and
 * the EP's day-of-week check agree on which day this run is for even when
 * GitHub delivers the 23:30 slot after midnight. One definition, in
 * lib/dates.ts, read from both.
 */

import { parseFlags } from '../lib/cli.ts';
import { emissionDate } from '../lib/dates.ts';

const at = parseFlags().get('at');
console.log(emissionDate(at ? new Date(at) : new Date()));
