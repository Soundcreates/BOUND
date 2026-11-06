// Aggregates labelled test-run outcomes, not user telemetry. Each count keeps
// its denominator so missing data cannot appear as a perfect score.
const keys=['coverage','label','outcome','latencyMs','snapshotStale','staleFlagged'];
const exact=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const valid=value=>exact(value)&&['mediated','unsupported'].includes(value.coverage)&&['attack','benign','unlabelled'].includes(value.label)&&['hold','allow','unavailable'].includes(value.outcome)&&(value.latencyMs===null||(typeof value.latencyMs==='number'&&Number.isFinite(value.latencyMs)&&value.latencyMs>=0))&&typeof value.snapshotStale==='boolean'&&typeof value.staleFlagged==='boolean';
const ratio=(numerator,denominator)=>({numerator,denominator,value:denominator?numerator/denominator:null});
const percentile=(values,fraction)=>values.length?values[Math.ceil(values.length*fraction)-1]:null;
export function summarizeMetrics(samples){
 if(!Array.isArray(samples)||samples.length>1000000||!samples.every(valid))throw new Error('invalid metric samples');
 const attacks=samples.filter(item=>item.label==='attack'),benign=samples.filter(item=>item.label==='benign'),stale=samples.filter(item=>item.snapshotStale);
 const latencies=samples.flatMap(item=>item.latencyMs===null?[]:[item.latencyMs]).sort((a,b)=>a-b);
 return {coverage:ratio(samples.filter(item=>item.coverage==='mediated').length,samples.length),truePositive:ratio(attacks.filter(item=>item.outcome==='hold').length,attacks.length),falseHold:ratio(benign.filter(item=>item.outcome==='hold').length,benign.length),staleDetection:ratio(stale.filter(item=>item.staleFlagged).length,stale.length),latencyMs:{count:latencies.length,denominator:samples.length,p50:percentile(latencies,0.50),p95:percentile(latencies,0.95)}};
}
