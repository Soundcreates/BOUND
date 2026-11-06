import test from "node:test";
import assert from "node:assert/strict";
import {normalizeSettings} from "./settings.mjs";

test("settings normalize public endpoints and reject unsafe watcher URLs",()=>{
 const value=normalizeSettings({watcherUrl:"http://127.0.0.1:8080/v1/observations",ensResolver:"0x"+"A".repeat(40)});
 assert.equal(value.ensResolver,"0x"+"a".repeat(40));assert.equal(value.network,"sepolia");
 for(const watcherUrl of ["http://example.com/v1/observations","https://user:password@example.com/v1/observations","https://example.com/v1/observations?secret=x","https://example.com/other"])assert.throws(()=>normalizeSettings({watcherUrl}));
 assert.throws(()=>normalizeSettings({arkivRpcUrl:"http://example.com"}));
});
