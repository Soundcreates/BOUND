timport {createArkivTransport} from './transport.js';
import {createArkivEntityReader} from './entity.js';

// Public, owner-checked read used by the curator CLI. No signing key is needed.
export async function readArkivEntity({url,accessKey,owner,chainId,schemaTag,entityKey,fetchImpl=fetch}){
 const transport=createArkivTransport({url,accessKey,fetchImpl});
 const reader=createArkivEntityReader({rpc:transport.rpc,owner,schemaTag,chainId});
 return reader.getEntity(entityKey);
}
