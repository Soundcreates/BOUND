// Source defaults for development; build.mjs generates this file in dist from .env.
import {scoreConfigFromEnv} from './score-config.mjs';
export const SCORE_SETTINGS = scoreConfigFromEnv();
// No aggregator key in source runs: reports stay queued. build.mjs pins it from BOUND_INTAKE_PUBLIC_KEY.
export const INTAKE_KEY = null;
