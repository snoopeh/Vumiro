import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../Vumiro.Client/WebServer/call-client.js',import.meta.url),'utf8');
const localSource=fs.readFileSync(new URL('../Vumiro.Client/WebServer/local-profile.js',import.meta.url),'utf8');
const functionAt=(name,end)=>source.slice(source.indexOf('  function '+name+'('),source.indexOf(end,source.indexOf('  function '+name+'(')));

test('room layout explicitly localizes counts and the self suffix while preserving names',()=>{
  class Element {
    constructor(tag){this.tagName=tag;this.children=[];this.attributes={};this.classList={toggle(){}};this.style={};}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=[...children];}
    setAttribute(name,value){this.attributes[name]=value;}
  }
  const elements=new Map(),name='Rooms <img src=x> (you)',localTile={sharing:false},peers=new Map();
  const sandbox={Intl,console,setTimeout,clearTimeout,navigator:{languages:['pt-BR']},localStorage:{getItem:()=>null},document:{createElement:tag=>new Element(tag)},$:id=>{if(!elements.has(id))elements.set(id,new Element('div'));return elements.get(id);},profileCache:new Map([['self',{name,avatar:''}]]),peers,localTile,selfId:'self',identity:{id:'self'},manualFocus:false,focusedId:'',joined:true,joining:false,disconnected:false,mosaic:{update(){}},avatarElement:()=>new Element('img'),fallbackAvatar:()=>'',refreshLayout(){}};
  sandbox.window=sandbox;vm.createContext(sandbox);
  const i18n=fs.readFileSync(new URL('../Vumiro.Client/WebServer/i18n.js',import.meta.url),'utf8');
  // Load localization before adding a DOM; the renderer under test owns these nodes.
  const document=sandbox.document;delete sandbox.document;vm.runInContext(i18n,sandbox);sandbox.document=document;
  vm.runInContext(functionAt('refreshLayout','  function openParticipantProfile('),sandbox);
  sandbox.refreshLayout();
  assert.equal(elements.get('participantCount').textContent,'1 pessoa');
  assert.equal(elements.get('peopleList').children[0].children[1].children[0].textContent,name+' (você)');
  peers.set('friend',{id:'friend',name:'Friends',tile:{sharing:false},pc:{connectionState:'connected'}});
  sandbox.refreshLayout();assert.equal(elements.get('participantCount').textContent,'2 pessoas');
  assert.equal(elements.get('peopleList').children[1].children[1].children[0].textContent,'Friends');
  vm.runInContext(functionAt('showProfile','  function ownProfile(')+functionAt('tile','  function play('),sandbox);
  const tile=sandbox.tile(name,true);assert.equal(tile.heading.textContent,name+' (você)');
  sandbox.showProfile(tile,{name,avatar:''},true);assert.equal(tile.heading.textContent,name+' (você)');
});

test('late locale synchronization updates a protected self heading before the local profile card is available',()=>{
  class Element {
    constructor(tag){this.tagName=tag;this.children=[];this.attributes={};this.style={};this.hidden=false;}
    append(...children){this.children.push(...children);}
    setAttribute(name,value){this.attributes[name]=value;}
  }
  const name='Rooms <img src=x> (you)',elements=new Map(),listeners=new Map();
  const app={Intl,console,setTimeout,clearTimeout,navigator:{languages:['en']},localStorage:{getItem:()=>null},location:{origin:'https://vumiro.test'},addEventListener(type,callback){listeners.set(type,callback);},dispatchEvent(event){listeners.get(event.type)?.(event);},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},renderRoom(){},refreshLayout(){},ownProfile:()=>null,profileCache:new Map(),profileViewingId:'',peers:new Map(),fallbackAvatar:()=>'',selfId:'self',identity:{id:'self'},focusedId:'',manualFocus:false,$:id=>{if(!elements.has(id))elements.set(id,new Element('div'));return elements.get(id);}};
  app.window=app;app.parent=app;vm.createContext(app);
  vm.runInContext(fs.readFileSync(new URL('../Vumiro.Client/WebServer/i18n.js',import.meta.url),'utf8'),app);
  app.document={createElement:tag=>new Element(tag)};
  vm.runInContext(functionAt('tile','  function play(')+functionAt('showProfile','  function ownProfile('),app);
  app.localTile=app.tile(name,true);elements.set('name',{value:'An unrelated draft'});
  assert.equal(app.localTile.heading.textContent,name+' (you)');
  const listenerStart=source.indexOf("  addEventListener('vumiro:localechange'");
  vm.runInContext(source.slice(listenerStart,source.indexOf('  function renderRoom(',listenerStart)),app);
  app.VumiroI18n.setLocale('pt-BR',{broadcast:false});
  assert.equal(app.localTile.heading.textContent,name+' (você)','locale listener renders app suffix despite unavailable profile; name is never parsed');
  app.showProfile(app.localTile,{name:'Updated Rooms',avatar:''},true);
  app.VumiroI18n.setLocale('es',{broadcast:false});
  assert.equal(app.localTile.heading.textContent,'Updated Rooms (tú)','latest validated name remains stable when the profile getter is temporarily unavailable');
});

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

test('room chat formats a small safe Markdown subset using text nodes and HTTPS links',()=>{
  class Element { constructor(tag,text=''){this.tagName=tag;this.textContent=text;this.children=[];this.attributes={};} append(...children){this.children.push(...children);} }
  const target=new Element('div'),sandbox={URL,chatEpoch:0,signalUrl:()=>new URL('wss://signal.example.com/call-signaling'),fetch:async()=>({ok:true,json:async()=>({title:'Example domain'})}),localStorage:{getItem:()=>null},addEventListener(){},document:{createElement:tag=>new Element(tag),createTextNode:text=>new Element('#text',text)}};vm.createContext(sandbox);
  vm.runInContext(functionAt('renderChatText','  let callSoundsEnabled=')+functionAt('publicChatUrl','  function chatRasterType('),sandbox);
  sandbox.renderChatText(target,'**bold** *italic* `code`\nhttps://example.com <img src=x>');
  assert.deepEqual(target.children.map(node=>node.tagName),['strong','#text','em','#text','code','br','a','#text','div']);
  assert.equal(target.children[0].textContent,'bold');assert.equal(target.children[2].textContent,'italic');assert.equal(target.children[4].textContent,'code');
  assert.equal(target.children[6].href,'https://example.com/');assert.equal(target.children[6].rel,'noopener noreferrer');assert.equal(target.children[7].textContent,' <img src=x>');assert.equal(target.children.at(-1).className,'chat-link-card');
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

test('room cards use a directory-issued named handle without a redundant username line',()=>{
  const elements=new Map(),context={$:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);},profileRequestId:'friend-id',profileRequestTimer:0,profileAddBusy:false,clearTimeout(){}};
  vm.createContext(context);vm.runInContext(functionAt('friendStatus',"  $('profileClose')"),context);
  context.friendStatus({id:'friend-id',status:'friend',friendTag:'#12345-67890',friendHandle:'mira#123'});
  assert.equal(elements.get('profileTag').textContent,'mira#123');assert.equal(elements.get('profileTag').hidden,false);assert.equal(elements.get('profileUsername').hidden,true);
  context.friendStatus({id:'friend-id',status:'friend',friendTag:'#12345-67890',friendHandle:'<unsafe>#123'});assert.equal(elements.get('profileTag').textContent,'#12345-67890');
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
  const sandbox={window:{},peers:new Map(),profileViewingId:'', $:id=>{if(!elements.has(id))elements.set(id,new Element('div'));return elements.get(id);},document:{createElement:tag=>new Element(tag)},fallbackAvatar:()=>'<fallback>'};vm.createContext(sandbox);
  vm.runInContext(functionAt('renderParticipantCard','  function friendStatus('),sandbox);
  sandbox.renderParticipantCard(app.cleanProfile({name:'<img src=x onerror=alert(1)>',bio:'<script>literal text</script>',connections:[{provider:'github',url:'https://github.com/snoopeh'}]}),false);
  assert.equal(elements.get('profileName').textContent,'<img src=x onerror=alert(1)>');
  assert.equal(elements.get('profileBio').textContent,'<script>literal text</script>');
  const link=elements.get('profileLinks').children[0];assert.equal(link.href,'https://github.com/snoopeh');assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');
  assert.equal(elements.get('profileBanner').hidden,true);assert.equal(elements.get('profileConnections').hidden,false);
  sandbox.renderParticipantCard(app.cleanProfile({name:'No links'}),false);
  assert.equal(elements.get('profileLinks').children.length,0);assert.equal(elements.get('profileConnections').hidden,true);assert.equal(elements.get('profileBio').hidden,true);
});
