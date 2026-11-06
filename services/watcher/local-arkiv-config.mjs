// Share the existing demo writer configuration without copying secrets into logs.
// Nonempty watcher-specific settings take precedence; invalid overrides fail closed.
export function localArkivConfig(env) {
  const pick=(primary,fallback)=>env[primary]?.trim()||env[fallback]?.trim();
  return {
    url:pick('BOUND_ARKIV_RPC_URL','ARKIV_RPC_URL'),
    owner:pick('BOUND_ARKIV_OWNER','ARKIV_TEST_WRITER_ADDRESS')?.toLowerCase(),
    chainId:Number(pick('BOUND_ARKIV_CHAIN_ID','ARKIV_CHAIN_ID')),
    privateKey:pick('BOUND_ARKIV_PRIVATE_KEY','ARKIV_TEST_WRITER_PRIVATE_KEY'),
  };
}
