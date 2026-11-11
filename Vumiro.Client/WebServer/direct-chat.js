/* The People conversation pane keeps an identity-scoped verified cache. */
(() => {
  'use strict';
  const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
  let opened;
  function database(){if(!opened)opened=new Promise((resolve,reject)=>{const request=window.indexedDB.open('vumiro-direct-chat',1);request.onupgradeneeded=()=>{const store=request.result.createObjectStore('messages',{keyPath:['owner','friend','from','id']});store.createIndex('timeline',['owner','friend','sequence']);};request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();opened=null;};resolve(request.result);};request.onerror=()=>{opened=null;reject(request.error||Error('Direct message history is unavailable.'));};request.onblocked=()=>reject(Error('Close other Vumiro windows to open direct message history.'));});return opened;}
  const indexed={
    async append(owner,friend,message){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('messages','readwrite');tx.objectStore('messages').put({owner,friend,from:message.from,id:message.id,sequence:message.sequence,message});tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error||Error('Direct message history could not be saved.'));});},
    async history(owner,friend){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('messages'),messages=[];const request=tx.objectStore('messages').index('timeline').openCursor(window.IDBKeyRange.bound([owner,friend,0],[owner,friend,Number.MAX_SAFE_INTEGER]),'prev');request.onsuccess=()=>{const cursor=request.result;if(cursor){messages.push(cursor.value.message);if(messages.length<200)cursor.continue();}};tx.oncomplete=()=>resolve(messages.reverse());tx.onabort=tx.onerror=()=>reject(tx.error||Error('Direct message history is unavailable.'));});}
  };
  function create({transport,getProfile,getFriends,onEnter=()=>{},onExit=()=>{},onNotify=()=>{},onThreadsChange=()=>{},localStore=indexed,validate=async()=>true}){
    const owner=getProfile()?.id;if(!validId(owner))throw Error('A local signing identity is required.');
    const $=id=>document.getElementById(id),handlers=[],cache=new Map(),threads=new Map(),drafts=new Map(),reads=new Map(),failed=new Map(),sending=new Set(),seen=new Map(),olderWindows=new Set();
    let active='',visible=false,destroyed=false,epoch=0,connection={connected:false,available:false},before=null,loading=false;
    const current=()=>!destroyed&&getProfile()?.id===owner;
    const friend=id=>getFriends().find(value=>value.id===id);
    const label=value=>value?.nickname||value?.name||'Friend';
    const text=(id,value)=>{if($(id))$(id).textContent=value;};
    const status=value=>text('directChatStatus',value);
    const readKey=id=>'vumiro-dm-read:'+owner+':'+id;
    const historyViewport=()=>$('directHistoryViewport')||$('directChatLog');
    function readSequence(id){if(!reads.has(id)){let sequence=0;try{sequence=Number(window.localStorage.getItem(readKey(id)))||0;}catch{}reads.set(id,sequence);}return reads.get(id);}
    const nearBottom=log=>!log||log.scrollHeight-log.scrollTop-log.clientHeight<=64;
    function markRead(){if(!current()||!visible||!active||document.hidden||document.hasFocus?.()===false||!nearBottom(historyViewport()))return;const latest=Math.max(readSequence(active),0,...[...($('directChatLog')?.children||[])].map(row=>Number(row.dataset.sequence)||0));reads.set(active,latest);try{window.localStorage.setItem(readKey(active),String(latest));}catch{}}
    function rows(id){return [...(cache.get(id)?.values()||[])].sort((a,b)=>a.sequence-b.sequence);}
    function conversation(id){const thread=current()&&friend(id)?threads.get(id):null;return {storedAt:thread?.storedAt||0,unread:!!thread&&thread.from!==owner&&thread.sequence>readSequence(id)};}
    function renderList(){
      if(!current())return;
      const unread=getFriends().filter(person=>conversation(person.id).unread).length;
      text('messagesCount',String(unread));if($('messagesCount'))$('messagesCount').hidden=!unread;onThreadsChange();
    }
    function renderMessages(scroll='preserve'){
      if(!current())return;const log=$('directChatLog');if(!log)return;
      const scroller=historyViewport(),top=scroller.scrollTop,height=scroller.scrollHeight,viewport=scroller.getBoundingClientRect(),anchor=[...log.children].find(row=>row.getBoundingClientRect().bottom>viewport.top),anchorKey=anchor?.dataset.messageKey,offset=anchor?anchor.getBoundingClientRect().top-viewport.top:0;
      log.replaceChildren();
      for(const message of rows(active)){const row=document.createElement('li');row.className='directMessage';row.dataset.messageId=message.id;row.dataset.messageKey=message.from+':'+message.id;row.dataset.sequence=String(message.sequence);const head=document.createElement('div');head.className='directMessageHead';const author=document.createElement('strong');author.textContent=message.from===owner?(getProfile().name||'You'):label(friend(message.from));const time=document.createElement('time');time.dateTime=new Date(message.storedAt||message.timestamp).toISOString();time.textContent=new Date(message.storedAt||message.timestamp).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});head.append(author,time);const body=document.createElement('p');body.className='directMessageText';body.textContent=message.text;row.append(head,body);if(message.from===owner){const state=document.createElement('small');state.className='directStored';state.textContent='Stored';row.append(state);}log.append(row);}
      if(scroll==='bottom')scroller.scrollTop=scroller.scrollHeight;
      else{const next=anchorKey&&[...log.children].find(row=>row.dataset.messageKey===anchorKey);scroller.scrollTop=next?scroller.scrollTop+next.getBoundingClientRect().top-scroller.getBoundingClientRect().top-offset:scroll==='older'?top+scroller.scrollHeight-height:top;}
      text('directChatEmpty',active&&!rows(active).length?'This is the beginning of your conversation.':'');
    }
    function controls(){const person=friend(active);if($('directChatText'))$('directChatText').disabled=!person;if($('directChatSend'))$('directChatSend').disabled=!person||!connection.connected||!connection.available||sending.has(active);if($('directHistoryMore')){$('directHistoryMore').hidden=!before;$('directHistoryMore').disabled=loading;}text('directChatConnection',connection.connected&&connection.available?'Messages are stored securely in transit. The server operator can read them.':connection.connected?'Direct messages need the updated connection service.':'Offline. Reconnect to send direct messages.');}
    async function receive(message,{history=false,persist=true,render=true,retain='latest'}={}){
      if(!current()||!message||typeof message.text!=='string'||!Number.isSafeInteger(message.sequence)||message.sequence<1||message.from!==owner&&message.to!==owner)return false;
      const id=message.from===owner?message.to:message.from;if(!friend(id)||!validId(id))return false;
      if(!cache.has(id))cache.set(id,new Map());if(!seen.has(id))seen.set(id,new Set());const messages=cache.get(id),known=seen.get(id),key=message.from+':'+message.id,duplicate=known.has(key);known.add(key);if(known.size>800)known.delete(known.values().next().value);messages.set(key,message);
      if(messages.size>400){const ordered=[...messages].sort((a,b)=>a[1].sequence-b[1].sequence),discard=retain==='older'||olderWindows.has(id)?ordered.slice(400):ordered.slice(0,messages.size-400);for(const [key]of discard)messages.delete(key);}
      const previous=threads.get(id);if(!previous||message.sequence>previous.sequence)threads.set(id,{friend:id,id:message.id,sequence:message.sequence,storedAt:message.storedAt,from:message.from});
      if(persist&&!duplicate){try{await localStore.append(owner,id,message);}catch{if(current())status('Message stored on the server; the local history cache could not be saved.');}}
      if(!current())return false;
      const focused=visible&&active===id&&!document.hidden&&document.hasFocus?.()!==false;
      if(render&&focused){const follow=nearBottom(historyViewport());renderMessages(follow?'bottom':'preserve');markRead();}
      if(render)renderList();
      if(!history&&!duplicate&&message.from!==owner&&!focused)onNotify(friend(id),message);
      return true;
    }
    async function loadHistory(older=false){
      const id=active,version=epoch;if(!friend(id)||!current()||loading||older&&!before)return;loading=true;controls();
      try{const page=await transport.history(friend(id),{before:older?before:null,limit:50});if(!current()||epoch!==version||active!==id)return;if(older)olderWindows.add(id);else olderWindows.delete(id);for(const message of page.messages||[]){if(!current()||epoch!==version)return;await receive(message,{history:true,render:false,retain:older?'older':'latest'});}if(!current()||epoch!==version||active!==id)return;before=page.before||null;status('');renderMessages(older?'older':'bottom');markRead();renderList();}
      catch(error){if(current()&&epoch===version)status(error.message||'Direct message history is unavailable.');}
      finally{if(current()&&epoch===version){loading=false;controls();}}
    }
    async function open(id){
      if(!current())return;if(active)drafts.set(active,$('directChatText').value);++epoch;const version=epoch;visible=true;active=friend(id)?id:'';olderWindows.delete(active);before=null;loading=false;onEnter();if($('directChatPane'))$('directChatPane').hidden=false;
      text('directChatName',label(friend(active)));$('directChatText').value=drafts.get(active)||'';if($('directChatConversation'))$('directChatConversation').hidden=!active;if($('directChatWelcome'))$('directChatWelcome').hidden=!!active;renderMessages();renderList();controls();
      if(!active)return;
      try{for(const message of await localStore.history(owner,active)){if(!current()||epoch!==version)return;const valid=await validate(message);if(!current()||epoch!==version)return;if(valid)await receive(message,{history:true,persist:false,render:false});}}catch{if(current()&&epoch===version)status('Local history is unavailable. Reconnecting can restore server history.');}
      if(!current()||epoch!==version)return;renderMessages('bottom');markRead();renderList();$('directChatText').focus?.();if(connection.connected&&connection.available)await loadHistory();
    }
    async function submit(){
      if(!current()||!friend(active)||sending.has(active))return;const id=active,person=friend(id),value=$('directChatText').value;if(!value.trim())return;if(!connection.connected||!connection.available){status(connection.connected?'Direct messages need the updated connection service.':'Reconnect to send. Your draft stays here.');return;}
      if(value.length>2000){status('Keep messages under 2000 characters.');return;}
      const prior=failed.get(id),messageId=prior?.text===value?prior.id:crypto.randomUUID();failed.set(id,{id:messageId,text:value});sending.add(id);controls();if(active===id)status('Sending…');
      try{const message=await transport.sendMessage(person,value,{id:messageId});if(!current())return;const accepted=await receive(message,{history:true});if(!current()||!accepted)return;failed.delete(id);if(active===id&&$('directChatText').value===value){$('directChatText').value='';drafts.delete(id);}else if(drafts.get(id)===value)drafts.delete(id);if(active===id)status('Stored. Your friend can receive this when they reconnect.');}
      catch(error){if(current()&&active===id)status(error.message||'Message could not be stored. Your draft stays here.');}
      finally{sending.delete(id);if(current())controls();}
    }
    async function syncInbox(){if(!current()||!connection.connected||!connection.available)return;try{const result=await transport.inbox();if(!current())return;for(const thread of (result.threads||[]).slice(0,128)){if(friend(thread.friend)&&Number.isSafeInteger(thread.sequence)&&thread.sequence>0&&thread.sequence>(threads.get(thread.friend)?.sequence||0))threads.set(thread.friend,thread);}renderList();if(visible&&active&&!olderWindows.has(active))await loadHistory();}catch(error){if(current()&&visible)status(error.message||'Could not refresh direct messages.');}}
    function hide(){if(active&&current())drafts.set(active,$('directChatText').value);visible=false;++epoch;if($('directChatPane'))$('directChatPane').hidden=true;}
    function state(value){if(!current())return;connection={...connection,...value};controls();if(value.connected&&value.available)void syncInbox();}
    function refresh(){if(active&&!friend(active)){active='';void open('');return;}text('directChatName',label(friend(active)));renderList();controls();}
    function listen(node,type,handler){node?.addEventListener(type,handler);handlers.push(()=>node?.removeEventListener(type,handler));}
    listen($('directChatForm'),'submit',event=>{event.preventDefault();void submit();});
    listen($('directChatText'),'keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();void submit();}});
    listen($('directHistoryMore'),'click',()=>{void loadHistory(true);});listen($('directChatBack'),'click',()=>{void open('');onExit();});
    listen(historyViewport(),'scroll',()=>{markRead();renderList();});
    listen(document,'visibilitychange',()=>{if(!document.hidden){markRead();renderList();}});listen(window,'focus',()=>{markRead();renderList();});
    renderList();controls();
    return {open,hide,state,receive,submit,refresh,syncInbox,conversation,get active(){return visible?active:'';},get visible(){return visible;},destroy(){hide();destroyed=true;for(const remove of handlers)remove();cache.clear();threads.clear();drafts.clear();seen.clear();olderWindows.clear();}};
  }
  window.VumiroDirectChat={create};
})();
