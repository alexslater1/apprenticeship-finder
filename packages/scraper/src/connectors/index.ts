import { avature } from './avature.ts';
import { cgJobstream, entainApi, lidl, skycareers } from './custom.ts';
import { eightfold } from './eightfold.ts';
import { jsonld, manual, pagehash } from './generic.ts';
import { oleeo } from './oleeo.ts';
import { oracle } from './oracle.ts';
import { phenom } from './phenom.ts';
import {
  ashby,
  greenhouse,
  lever,
  personio,
  pinpoint,
  recruitee,
  smartrecruiters,
  teamtailor,
  workable,
} from './simple.ts';
import { successfactors } from './successfactors.ts';
import type { Connector } from './types.ts';
import { workday } from './workday.ts';

/** Every connector by id. Detection (detect-ats, Add company) tries them in this order. */
export const CONNECTORS: Connector<never>[] = [
  workday,
  successfactors,
  oracle,
  avature,
  oleeo,
  eightfold,
  phenom,
  greenhouse,
  lever,
  ashby,
  smartrecruiters,
  workable,
  teamtailor,
  recruitee,
  personio,
  pinpoint,
  skycareers,
  cgJobstream,
  entainApi,
  lidl,
  jsonld,
  pagehash,
  manual,
] as unknown as Connector<never>[];

export const connectorById = new Map(CONNECTORS.map((c) => [c.id, c]));
