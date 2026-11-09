import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../Vumiro.Client/WebServer/friends-client.js',import.meta.url),'utf8');
const saveAvatarSource=source.match(/async function saveAvatar\(value,version\) \{[\s\S]*?\n\}/)?.[0];assert.ok(saveAvatarSource);

test('profile image edits stage in the draft until the unified profile Save action',async()=>{
  const calls=[],elements={profileError:{textContent:''}};let rendered=false;const sandbox={avatarSelection:4,avatarDraft:'old-image',renderOwnProfile(){rendered=true;},$:id=>elements[id],local:{async updateProfile(value){calls.push(value);}}};
  vm.createContext(sandbox);vm.runInContext(saveAvatarSource,sandbox);
  await sandbox.saveAvatar('new-image',4);
  assert.equal(sandbox.avatarDraft,'new-image');assert.equal(rendered,true);assert.deepEqual(calls,[]);
  assert.match(elements.profileError.textContent,/Save your profile/);
});

test('a stale image processing result cannot replace a newer profile draft',async()=>{
  const sandbox={avatarSelection:9,avatarDraft:'current',renderOwnProfile(){},$:()=>({textContent:''})};
  vm.createContext(sandbox);vm.runInContext(saveAvatarSource,sandbox);
  await sandbox.saveAvatar('late-image',8);assert.equal(sandbox.avatarDraft,'current');
});
