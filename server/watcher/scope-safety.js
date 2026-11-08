export function parseNormalScopes(value, defaultChainId) {
 if (!Number.isSafeInteger(defaultChainId) || defaultChainId < 1) throw new Error('invalid BOUND_LOCAL_INTAKE_CHAIN_ID');
 if (!value) return [];
 return value.split(',').map(raw=>{
  const entry=raw.trim(), parts=entry.split('@'), site=parts[0];
  const chainId=parts.length===1?defaultChainId:Number(parts[1]);
  let valid=false;
  try { const url=new URL(`http://${site}`); valid=!!site && site.length<=253 && url.host===site && url.pathname==='/' && !url.username && !url.password && !url.search && !url.hash; } catch {}
  if (!valid || parts.length>2 || (parts.length===2 && !/^[1-9]\d*$/.test(parts[1])) || !Number.isSafeInteger(chainId) || chainId<1) throw new Error(`invalid BOUND_LOCAL_INTAKE_NORMAL_SCOPES entry: ${entry}`);
  return {site,chainId};
 });
}
export function createScopeSafety({normalScopes,watcher,archive}) {
 const allowed=new Set(normalScopes.map(({site,chainId})=>JSON.stringify([site,chainId])));
 return async ({site,chainId})=>{
  const status=archive ? await archive.getLatestStatus(site,chainId) : null;
  const rawDrift=status?.state==='drift' || (await watcher.triggers(site,chainId)).length>0;
  const incident=status?.state==='incident';
  return {known:allowed.has(JSON.stringify([site,chainId])) && !rawDrift && !incident,rawDrift,incident};
 };
}

// Approval is bound to the exact drift status version, and is independent of reports.
export async function recoverLocalDrift({site,chainId,watcher,archive,canRecover,makeStatus,operationId}) {
 if(!archive || typeof canRecover!=='function') return false;
 const version=await archive.getStatusVersion(site,chainId);
 const status=await archive.getLatestStatus(site,chainId);
 if(status?.state!=='drift' || typeof version!=='string' || !/^[0-9a-f]{64}$/.test(version)) return false;
 if(!await watcher.recoveryQuiet(site,chainId) || !await canRecover(site,chainId,{incidentId:version})) return false;
 const normal=makeStatus(site,chainId);
 const result=await archive.writeRecoveryStatus(normal,operationId(normal),version);
 if(result?.state!=='current') throw new Error('local drift recovery superseded or unverified');
 return true;
}

// Reconcile a lost status acknowledgement before deciding whether recovery is needed.
export async function publishLocalStatus({site,chainId,state,status,statusId,watcher,archive,canRecover,operationId}) {
 const previous=await archive.reconcileStatus(site,chainId);
 if(state==='normal' && previous && previous.record.state!=='normal') {
  return recoverLocalDrift({site,chainId,watcher,archive,canRecover,makeStatus:()=>status,operationId});
 }
 return archive.writeStatus(status,statusId,state==='normal'?(previous?.id??null):undefined);
}
