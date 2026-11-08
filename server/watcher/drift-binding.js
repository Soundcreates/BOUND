import {openDriftState} from './drift-state.js';
import {createDriftMonitor} from './monitor.js';

export async function openWatchedDrift({path,now,maxAgeMs,readBaseline,poll,publish}) {
 const state=await openDriftState({path,now,maxAgeMs});
 const monitor=createDriftMonitor({readBaseline,poll,publish,onObservation:state.markSuccess,onPollFailure:state.markUnavailable});
 return {monitor,readStatus:state.read,hasCorroboratedDrift:state.hasCorroboratedDrift};
}
