import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGamingSignal,gamingSignalText,verifyGamingSignal} from './gaming-signals.js';

const from='a'.repeat(43),to='b'.repeat(43),now=1700000000000;
const envelope=(payload={kind:'invite',mode:'lan'})=>({type:'gaming-signal',from,to,session:'c'.repeat(32),nonce:'signal_nonce_123456789012',expires:now+60000,payload,signature:Buffer.alloc(64).toString('base64url')});
test('accepts bounded known payloads without changing canonical property ordering',()=>{
  for(const payload of [{kind:'invite',mode:'lan'},{kind:'invite',mode:'together'},{kind:'accept'},{kind:'decline'},{kind:'end'},
    {kind:'offer',description:{sdp:'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n',type:'offer'}},{kind:'answer',description:{type:'answer',sdp:'v=0\r\n'}},
    {kind:'ice',candidate:null},{kind:'ice',candidate:{candidate:''}},{kind:'ice',candidate:{candidate:'candidate:1 1 UDP 123 192.168.1.2 5000 typ host',sdpMid:'0',sdpMLineIndex:0,usernameFragment:'user'}}]) {
    const value=envelope(payload),clean=validateGamingSignal(value,from,to,now);
    assert.deepEqual(clean,value);assert.notEqual(clean,value);assert.notEqual(clean.payload,value.payload);
    assert.equal(gamingSignalText(clean),`vumiro-gaming-signal-v1\n${from}\n${to}\n${value.session}\n${value.nonce}\n${value.expires}\n${JSON.stringify(payload)}`);
  }
});
test('rejects malformed routing, unsigned fields, lifetime, and excessive UTF8 bytes',()=>{
  for(const update of [{from:to},{to:from},{to:'bad'},{session:'C'.repeat(32)},{nonce:'short'},{expires:now},{expires:now+120001},{expires:NaN},{signature:'unsigned'},{extra:true},{payload:{kind:'invite',mode:'external'}},{payload:{kind:'accept',mode:'lan'}}])
    assert.equal(validateGamingSignal({...envelope(),...update},from,to,now),null,JSON.stringify(update));
  const huge=envelope({kind:'offer',description:{type:'offer',sdp:'v=0\r\n'+'😀'.repeat(5000)}});
  assert.equal(validateGamingSignal(huge,from,to,now),null);
});
test('rejects invalid SDP and ICE shapes',()=>{
  for(const payload of [{kind:'offer',description:{type:'answer',sdp:'v=0\r\n'}},{kind:'answer',description:{type:'answer',sdp:''}},
    {kind:'offer',description:{type:'offer',sdp:'garbage'}},{kind:'offer',description:{type:'offer',sdp:'v=0\r\n\0'}},
    {kind:'ice',candidate:{candidate:'invalid'}},
    {kind:'ice',candidate:{candidate:'',sdpMLineIndex:-1}},{kind:'ice',candidate:{candidate:'',sdpMid:123}},{kind:'ice',candidate:{candidate:'',unknown:true}},{kind:'ice'}])
    assert.equal(validateGamingSignal(envelope(payload),from,to,now),null,JSON.stringify(payload));
});
test('allows signed standard relay ICE for a future Vumiro-operated TURN endpoint',()=>{
  assert.ok(validateGamingSignal(envelope({kind:'ice',candidate:{candidate:'candidate:1 1 UDP 1 1.2.3.4 5000 typ relay'}}),from,to,now));
  assert.ok(validateGamingSignal(envelope({kind:'offer',description:{type:'offer',sdp:'v=0\r\na=candidate:1 1 UDP 1 1.2.3.4 5000 typ relay\r\n'}}),from,to,now));
});
test('bounds optional LAN assignments to one reserved nonoverlapping pair',()=>{
  const assignment={address:'10.203.17.1',peerAddress:'10.203.17.254',prefix:24};
  assert.ok(validateGamingSignal(envelope({kind:'invite',mode:'lan',lan:assignment}),from,to,now));
  for(const update of [{address:'192.168.1.1'},{peerAddress:'10.203.17.1'},{peerAddress:'10.203.18.2'},{address:'10.203.251.1'},{prefix:16},{address:'10.203.017.1'},{peerAddress:'10.203.17.002'}])
    assert.equal(validateGamingSignal(envelope({kind:'invite',mode:'lan',lan:{...assignment,...update}}),from,to,now),null);
  assert.equal(validateGamingSignal(envelope({kind:'invite',mode:'together',lan:assignment}),from,to,now),null);
});
test('accepts only bounded canonical LAN topology updates in the same reserved subnet',()=>{
  assert.ok(validateGamingSignal(envelope({kind:'lan-peers',revision:1,addresses:['10.203.17.1','10.203.17.3']}),from,to,now));
  for(const addresses of [[],['10.203.17.0'],['10.203.17.1','10.203.18.2'],['10.203.17.1','10.203.17.1'],['10.203.251.1'],['10.203.17.1','10.203.17.2','10.203.17.3','10.203.17.4','10.203.17.5']])
    assert.equal(validateGamingSignal(envelope({kind:'lan-peers',revision:1,addresses}),from,to,now),null);
});
test('uses the existing real P256 identity key and canonical signature verifier contract',async()=>{
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const key=Buffer.from(await crypto.subtle.exportKey('spki',pair.publicKey)).toString('base64url');
  const value=envelope();value.signature=Buffer.from(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode(gamingSignalText(value)))).toString('base64url');
  const verify=async(keyText,signature,text)=>{
    assert.equal(keyText,key);
    return crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},pair.publicKey,Buffer.from(signature,'base64url'),new TextEncoder().encode(text));
  };
  assert.deepEqual(await verifyGamingSignal(value,{id:from,key},verify,now),value);
  assert.equal(await verifyGamingSignal({...value,payload:{kind:'invite',mode:'together'}},{id:from,key},verify,now),null);
  assert.equal(await verifyGamingSignal(value,{id:to,key},verify,now),null);
});
