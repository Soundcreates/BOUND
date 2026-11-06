import {normalizeSettings} from "./settings.mjs";
const form=document.querySelector("#settings"),status=document.querySelector("#status");
const fields=["ensRootName","ensResolver","arkivRpcUrl","watcherOwner","watcherUrl","anonBootstrapUrl","anonRpcUrl"];
// Phase 0 Rabdi/Sepolia test defaults, used only when no setting is saved yet. Editable; a
// deliberately-cleared field saves as "" and will not be re-filled by these on next load.
const DEFAULTS={
 ensRootName:"bound-v2.eth",
 ensResolver:"0xf6efa18d24c108a060b0d2a0e715b9045e09ea0f",
 arkivRpcUrl:"https://rpc.rabdi.db-chain.testnet.arkiv.network",
 watcherOwner:"0xE63393558E36dF643347326E7e03AD5fB0E6c867",
 watcherUrl:"http://127.0.0.1:8787/v1/observations",
 anonBootstrapUrl:"https://ethereum-sepolia-rpc.publicnode.com",
 anonRpcUrl:"https://ethereum-sepolia-rpc.publicnode.com"
};
const {boundSettings={}}=await chrome.storage.local.get("boundSettings");
for(const name of fields){const value=boundSettings[name]??DEFAULTS[name];form.elements[name].value=Array.isArray(value)?value.join("\n"):value??"";}
form.addEventListener("submit",async event=>{
 event.preventDefault();
 try{
  const raw=Object.fromEntries(fields.map(name=>[name,form.elements[name].value]));
  const settings=normalizeSettings(raw);await chrome.storage.local.set({boundSettings:settings});
  await chrome.runtime.sendMessage({type:"BOUND_SETTINGS_CHANGED_V1"}).catch(()=>{});
  status.textContent="Settings saved. Unavailable services remain untrusted.";
 }catch(error){status.textContent=error instanceof Error?error.message:"Could not save settings.";}
});
