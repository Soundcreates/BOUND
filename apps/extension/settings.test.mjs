import test from "node:test";
import assert from "node:assert/strict";
import {normalizeSettings} from "./settings.mjs";

test("settings normalize public endpoints and reject unsafe watcher URLs",()=>{
 const value=normalizeSettings({watcherUrl:"http://127.0.0.1:8080/v1/observations",ensResolver:"0x"+"A".repeat(40)});
 assert.equal(value.ensResolver,"0x"+"a".repeat(40));assert.equal(value.network,"sepolia");
 for(const watcherUrl of ["http://example.com/v1/observations","https://user:password@example.com/v1/observations","https://example.com/v1/observations?secret=x","https://example.com/other"])assert.throws(()=>normalizeSettings({watcherUrl}));
});

test("default settings seed once and never overwrite a saved configuration",async()=>{
 const {ensureDefaultSettings,DEFAULT_SETTINGS}=await import("./settings.mjs");
 const store=(initial)=>{let data={...initial};return {data:()=>data,get:async key=>key in data?{[key]:structuredClone(data[key])}:{},set:async value=>{data={...data,...structuredClone(value)};}};};
 const empty=store({});
 assert.equal(await ensureDefaultSettings(empty),true);
 const seeded=empty.data().boundSettings;
 assert.deepEqual(seeded,normalizeSettings(DEFAULT_SETTINGS));
 assert.equal(seeded.watcherOwner,DEFAULT_SETTINGS.watcherOwner.toLowerCase());
 assert.equal(seeded.watcherUrl,"https://bound-aggregator-0-1-1.onrender.com/v1/observations");
 assert.equal(await ensureDefaultSettings(empty),false);
 // A saved configuration with a deliberately cleared watcher URL stays as saved.
 const saved=normalizeSettings({...DEFAULT_SETTINGS,watcherUrl:""});
 const kept=store({boundSettings:saved});
 assert.equal(await ensureDefaultSettings(kept),false);
 assert.equal(kept.data().boundSettings.watcherUrl,"");
});
