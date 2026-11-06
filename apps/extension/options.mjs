import {normalizeSettings,DEFAULT_SETTINGS} from "./settings.mjs";
const form=document.querySelector("#settings"),status=document.querySelector("#status");
const fields=["ensRootName","ensResolver","arkivRpcUrl","watcherOwner","watcherUrl","anonBootstrapUrl","anonRpcUrl"];
// Defaults are seeded into storage by the service worker; they also fill the form
// when nothing is saved yet. A deliberately-cleared field saves as "" and stays empty.
const DEFAULTS=DEFAULT_SETTINGS;
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
