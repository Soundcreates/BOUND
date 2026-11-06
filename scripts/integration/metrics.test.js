import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {summarizeMetrics} from './metrics.js';
const sample={coverage:'mediated',label:'benign',outcome:'allow',latencyMs:5,snapshotStale:false,staleFlagged:false};
test('metrics preserve denominators and nearest-rank latency percentiles',()=>{
 const result=summarizeMetrics([sample,{...sample,label:'attack',outcome:'hold',latencyMs:50,snapshotStale:true,staleFlagged:true},{...sample,coverage:'unsupported',outcome:'hold',latencyMs:null}]);
 assert.deepEqual(result.coverage,{numerator:2,denominator:3,value:2/3});
 assert.deepEqual(result.truePositive,{numerator:1,denominator:1,value:1});
 assert.deepEqual(result.falseHold,{numerator:1,denominator:2,value:0.5});
 assert.deepEqual(result.staleDetection,{numerator:1,denominator:1,value:1});
 assert.deepEqual(result.latencyMs,{count:2,denominator:3,p50:5,p95:50});
});
test('missing samples yield null metrics and malformed data is rejected',()=>{
 const result=summarizeMetrics([]);assert.equal(result.truePositive.value,null);assert.equal(result.latencyMs.p95,null);
 assert.throws(()=>summarizeMetrics([{...sample,latencyMs:NaN}]),/invalid/);
 assert.throws(()=>summarizeMetrics([{...sample,wallet:'private'}]),/invalid/);
});
