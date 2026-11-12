import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../Vumiro.Client/WebServer/friends-client.js',import.meta.url),'utf8');
test('real avatar helper decorates after both image and initials fallback',()=>{const body=source.slice(source.indexOf('function avatar('),source.indexOf('function friendById'));assert.match(body,/VumiroProfileCosmetics\?\.decorateAvatar/);assert.match(body,/finally\s*\{/);});
test('real user card invokes card decorator and listens only to the dedicated cosmetic event',()=>{const body=source.slice(source.indexOf('function renderUserCard('),source.indexOf('function openUserCard('));assert.match(body,/VumiroProfileCosmetics\?\.decorateCard\(\$\('userCardDialog'\),value\)/);assert.match(source,/addEventListener\('vumiro-profile-cosmetics-updated'/);assert.match(source,/local\.initialize\(\);[^\n]*VumiroProfileCosmetics\?\.refreshOwn/);});
