import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../Vumiro.Client/WebServer/call-client.js',import.meta.url),'utf8');
const localSource=fs.readFileSync(new URL('../Vumiro.Client/WebServer/local-profile.js',import.meta.url),'utf8');
const functionAt=(name,end)=>source.slice(source.indexOf('  function '+name+'('),source.indexOf(end,source.indexOf('  function '+name+'(')));

test('idle stage and participant header use the same centered avatar image after profile updates',()=>{
  class Element {
    constructor(tag){this.tagName=tag;this.children=[];this.style={};this.hidden=false;this.classList={toggle(){}};}
    append(...children){this.children.push(...children);}
    setAttribute(){}
  }
  const tiles=new Element('section');let layouts=0;
  const sandbox={document:{createElement:tag=>new Element(tag)},$:id=>{assert.equal(id,'tiles');return tiles;},refreshLayout(){layouts++;},status(){},fallbackAvatar:name=>'fallback:'+name,peers:new Map()};
  vm.createContext(sandbox);
  vm.runInContext(functionAt('tile','  function play(')+functionAt('showProfile','  function ownProfile('),sandbox);
  const tile=sandbox.tile('Snopeeh',true);
  assert.equal(tile.placeholderAvatar.tagName,'img');
  assert.equal(tile.placeholderAvatar.src,'fallback:Snopeeh');
  assert.ok(tile.placeholder.children.includes(tile.placeholderAvatar));
  sandbox.showProfile(tile,{name:'New name',avatar:'data:image/png;base64,photo'},true);
  assert.equal(tile.placeholderAvatar.src,tile.avatar.src);
  assert.equal(tile.placeholderAvatar.src,'data:image/png;base64,photo');
  sandbox.showProfile(tile,{name:'No photo',avatar:''});
  assert.equal(tile.placeholderAvatar.src,tile.avatar.src);
  assert.equal(tile.placeholderAvatar.src,'fallback:No photo');
  assert.ok(layouts>=3);
});

function profileHarness({legacy=false}={}) {
  const sandbox={URL,TextEncoder,encoder:new TextEncoder()};vm.createContext(sandbox);
  const validators=localSource.slice(localSource.indexOf('  function cleanBio('),localSource.indexOf('  const cardFields ='));
  vm.runInContext(validators+`const local=${legacy?'{}':'{validateBio:cleanBio,validateBanner:cleanBanner,validateConnections:cleanConnections}'};`+functionAt('cleanProfile','  function showProfile('),sandbox);
  return sandbox;
}

test('room metadata retains validated profile card fields within the existing 64 KiB budget',()=>{
  const app=profileHarness(),photo='data:image/png;base64,'+'A'.repeat(32744),banner='data:image/webp;base64,'+'B'.repeat(16360);
  const input={name:'Snopeeh',username:'snopeeh',avatar:photo,bio:'A little closer.',banner,connections:[{provider:'github',url:'https://github.com/snoopeh'}],friendTag:'#12345-67890'};
  const profile=app.cleanProfile(input);
  assert.equal(profile.avatar,photo);assert.equal(profile.banner,banner);assert.equal(profile.bio,input.bio);assert.equal(profile.connections[0].url,input.connections[0].url);
  assert.equal(Object.hasOwn(profile,'friendTag'),false,'peer cannot assert a directory friend number');
  assert.ok(new TextEncoder().encode(JSON.stringify({type:'profile',profile})).length<=65536);
});

test('room profile metadata rejects unsafe connections, remote banners and oversized biographies',()=>{
  const app=profileHarness(),basic={name:'Safe',username:'safe_name',avatar:''};
  for(const patch of [
    {bio:'a'.repeat(241)}, {banner:'https://tracking.example/pixel.png'},
    {connections:[{provider:'github',url:'javascript:alert(1)'}]},
    {connections:[{provider:'github',url:'https://github.com.attacker.example/user'}]},
    {connections:[{provider:'github',url:'https://user:secret@github.com/user'}]},
    {connections:Array.from({length:6},()=>({provider:'github',url:'https://github.com/user'}))}
  ])assert.equal(app.cleanProfile({...basic,...patch}),null);
  const legacy=profileHarness({legacy:true}).cleanProfile({...basic,bio:'<unsafe>',banner:'https://tracking.example/pixel.png',connections:[{provider:'github',url:'javascript:alert(1)'}]});
  assert.equal(legacy.bio,'');assert.equal(legacy.banner,'');assert.equal(legacy.connections.length,0);
});

test('room profile card renders user text literally and opens validated links safely',()=>{
  class Element {
    constructor(tag){this.tagName=tag;this.children=[];this.attributes={};}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=[...children];}
    setAttribute(name,value){this.attributes[name]=value;}
    removeAttribute(name){delete this[name];}
  }
  const elements=new Map(),app=profileHarness();
  const sandbox={$:id=>{if(!elements.has(id))elements.set(id,new Element('div'));return elements.get(id);},document:{createElement:tag=>new Element(tag)},fallbackAvatar:()=>'<fallback>'};vm.createContext(sandbox);
  vm.runInContext(functionAt('renderParticipantCard','  function friendStatus('),sandbox);
  sandbox.renderParticipantCard(app.cleanProfile({name:'<img src=x onerror=alert(1)>',bio:'<script>literal text</script>',connections:[{provider:'github',url:'https://github.com/snoopeh'}]}),false);
  assert.equal(elements.get('profileName').textContent,'<img src=x onerror=alert(1)>');
  assert.equal(elements.get('profileBio').textContent,'<script>literal text</script>');
  const link=elements.get('profileLinks').children[0];assert.equal(link.href,'https://github.com/snoopeh');assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');
  assert.equal(elements.get('profileBanner').hidden,true);assert.equal(elements.get('profileConnections').hidden,false);
  sandbox.renderParticipantCard(app.cleanProfile({name:'No links'}),false);
  assert.equal(elements.get('profileLinks').children.length,0);assert.equal(elements.get('profileConnections').hidden,true);assert.equal(elements.get('profileBio').hidden,true);
});
