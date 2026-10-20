import { reset, state, events, key } from './helpers/applicationHarness.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runLiveSave } from '../src/runtime/background/liveSaveHandler.js';
import { updateSettings, getSettings } from '../src/application/settings/index.js';
import * as Directory from '../src/runtime/capabilities/dirHandleController.js';
let previousChrome:typeof chrome;
test.beforeEach(()=>{reset();Directory.setDirHandle(null);previousChrome=globalThis.chrome;globalThis.chrome={runtime:{sendMessage:async()=>({ok:true})}} as unknown as typeof chrome;});
test.afterEach(()=>{Directory.setDirHandle(null);globalThis.chrome=previousChrome;});
test('degraded Background Live Save rejects with reauthorization guidance without requesting permission or touching files',async()=>{
    let requests=0,probes=0;state.directory={name:'MyVault',queryPermission:async()=> 'prompt',requestPermission:async()=>{requests++;return 'granted';},keys:async function*(){probes++;yield 'file';}} as unknown as FileSystemDirectoryHandle;
    await updateSettings({enabledDisk:true});await assert.rejects(runLiveSave(key()),/Reauthorize.*Options/);assert.equal(requests,0);assert.equal(probes,0);assert.equal((await getSettings()).enabledDisk,true);assert.equal(events.includes('delivery'),false);
});
test('restoring a degraded handle retains it for explicit reauthorization and persists the granted capability',async()=>{
    let permission:PermissionState='prompt',requests=0;const handle={name:'Vault_Obsidian',queryPermission:async()=>permission,requestPermission:async()=>{requests++;permission='granted';return permission;}};
    state.directory=handle as unknown as FileSystemDirectoryHandle;assert.equal(await Directory.restoreSavedDirHandle(),null);assert.strictEqual(Directory.getPendingPermissionHandle(),handle);assert.equal(events.includes('clear-directory'),false);assert.equal(requests,0);
    assert.equal(await Directory.reauthorizeDirHandle(),true);assert.equal(requests,1);assert.strictEqual(Directory.getDirHandle(),handle);assert.strictEqual(state.directory,handle);assert.equal(Directory.getPendingPermissionHandle(),null);assert.equal(events.filter(x=>x==='save-directory').length,1);
});
