// Source defaults for development; build.mjs generates this file in dist from .env.
import {scoreConfigFromEnv} from './score-config.mjs';
export const SCORE_SETTINGS = scoreConfigFromEnv();
