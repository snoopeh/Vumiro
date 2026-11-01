const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const requireRuntime = process.env.SCREENTASK_NODE_MODULES ? createRequire(process.env.SCREENTASK_NODE_MODULES + '/package.json') : require;
const {chromium} = requireRuntime('playwright');
const origin = process.env.SCREENTASK_TEST_ORIGIN || 'http://localhost:17871';

async function main() {
  const browser = await chromium.launch({channel: 'chrome', headless: true});
  try {
    const page = await browser.newPage();
    // Browser WebSockets supply the actual page Origin, exercising the listener's
    // same-origin policy rather than bypassing it with a synthetic Node client.
    await page.goto(origin + '/direct');
    const results = await page.evaluate(async () => {
      const sockets = [];
      const room = 'call_test_' + crypto.randomUUID().replaceAll('-', '');
      const check = (condition, message) => { if (!condition) throw new Error(message); };
      function connect(roomId, name) {
        const address = new URL('/call-signaling', location.href);
        address.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        address.searchParams.set('room', roomId); address.searchParams.set('name', name);
        const ws = new WebSocket(address);
        const client = {ws, messages: [], closed: false, waiters: [], closeStatus: null}; sockets.push(client);
        const changed = () => {
          for (const waiter of [...client.waiters]) {
            const value = client.messages.find(waiter.predicate);
            if (value) { clearTimeout(waiter.timer); client.waiters.splice(client.waiters.indexOf(waiter), 1); waiter.resolve(value); }
          }
        };
        ws.onmessage = event => { client.messages.push(JSON.parse(event.data)); changed(); };
        client.close = new Promise(resolve => { ws.onclose = event => { client.closed = true; client.closeStatus = {code: event.code, reason: event.reason}; resolve(); }; });
        client.wait = predicate => {
          const existing = client.messages.find(predicate);
          if (existing) return Promise.resolve(existing);
          return new Promise((resolve, reject) => {
            const waiter = {predicate, resolve};
            waiter.timer = setTimeout(() => {
              client.waiters.splice(client.waiters.indexOf(waiter), 1);
              reject(new Error('Timed out waiting for call signaling (' + name + ', state ' + ws.readyState + ', close ' + JSON.stringify(client.closeStatus) + '): ' + JSON.stringify(client.messages)));
            }, 5000);
            client.waiters.push(waiter);
          });
        };
        client.send = message => ws.send(JSON.stringify(message));
        return client;
      }
      async function joined(roomId, name) {
        const client = connect(roomId, name);
        client.welcome = await client.wait(m => m.type === 'welcome');
        check(/^[a-f0-9]{32}$/.test(client.welcome.id), 'Server must assign an unpredictable peer ID');
        return client;
      }
      const signalCount = client => client.messages.filter(m => m.type === 'signal').length;
      try {
        const alice = await joined(room, 'Alice');
        check(alice.welcome.peers.length === 0, 'First participant must see an empty room');
        const bob = await joined(room, 'Bob');
        check(bob.welcome.peers.length === 1 && bob.welcome.peers[0].id === alice.welcome.id && bob.welcome.peers[0].name === 'Alice', 'Welcome must include existing participants');
        await alice.wait(m => m.type === 'peer-joined' && m.id === bob.welcome.id && m.name === 'Bob');
        const charlie = await joined(room, 'Charlie');
        check(charlie.welcome.peers.length === 2, 'A third participant must join the same room');
        await Promise.all([alice, bob].map(client => client.wait(m => m.type === 'peer-joined' && m.id === charlie.welcome.id)));
        const isolated = await joined(room + '_other', 'Isolated');
        check(isolated.welcome.peers.length === 0, 'Distinct rooms must have distinct membership');

        alice.send({type: 'signal', to: bob.welcome.id, from: 'forged-peer', description: {type: 'offer', sdp: 'test-offer'}});
        const offer = await bob.wait(m => m.type === 'signal' && m.description?.sdp === 'test-offer');
        check(offer.from === alice.welcome.id && !('to' in offer), 'Signals must carry only the trusted sender ID');
        bob.send({type: 'signal', to: alice.welcome.id, description: {type: 'answer', sdp: 'test-answer'}});
        await alice.wait(m => m.type === 'signal' && m.from === bob.welcome.id && m.description?.type === 'answer');
        charlie.send({type: 'signal', to: bob.welcome.id, candidate: {candidate: 'candidate:1 1 UDP 1 127.0.0.1 1234 typ host', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'test'}});
        await bob.wait(m => m.type === 'signal' && m.from === charlie.welcome.id && m.candidate?.sdpMid === '0');
        charlie.send({type: 'signal', to: bob.welcome.id, candidate: null});
        await bob.wait(m => m.type === 'signal' && m.from === charlie.welcome.id && m.candidate === null);

        const beforeIsolation = signalCount(bob);
        isolated.send({type: 'signal', to: bob.welcome.id, description: {type: 'offer', sdp: 'must-not-cross-rooms'}});
        isolated.ws.close(); await isolated.close;
        // Use a subsequent valid message as a processing barrier on the target.
        alice.send({type: 'signal', to: bob.welcome.id, candidate: {candidate: 'isolation-barrier'}});
        await bob.wait(m => m.type === 'signal' && m.candidate?.candidate === 'isolation-barrier');
        check(signalCount(bob) === beforeIsolation + 1, 'Signals must never cross room boundaries');
        check(signalCount(charlie) === 0, 'Directed signals must not broadcast to other participants');

        charlie.ws.close(); await charlie.close;
        await Promise.all([alice, bob].map(client => client.wait(m => m.type === 'peer-left' && m.id === charlie.welcome.id)));
        const replacement = await joined(room, 'Replacement');
        check(replacement.welcome.peers.length === 2 && !replacement.welcome.peers.some(p => p.id === charlie.welcome.id), 'Leaving must remove only that participant');

        const malformed = [
          {type: 'media', to: bob.welcome.id, data: 'not-signaling'},
          {type: 'signal', to: bob.welcome.id, description: {type: 'rollback', sdp: ''}},
          {type: 'signal', to: bob.welcome.id, candidate: 'not-an-ICE-object'},
          {type: 'signal', to: bob.welcome.id, candidate: {candidate: 'fake', media: 'bytes'}},
          {type: 'signal', to: bob.welcome.id, description: {type: 'offer', sdp: 'x'}, candidate: null},
          {type: 'signal', to: bob.welcome.id, description: {type: 'offer', sdp: 'x'.repeat(70 * 1024)}}
        ];
        for (const message of malformed) {
          const bad = await joined(room, 'Bad sender');
          const before = signalCount(bob);
          bad.send(message);
          await alice.wait(m => m.type === 'peer-left' && m.id === bad.welcome.id);
          await bob.wait(m => m.type === 'peer-left' && m.id === bad.welcome.id);
          check(signalCount(bob) === before, 'Invalid or oversized messages must not be relayed');
        }
        const binary = await joined(room, 'Binary sender');
        const beforeBinary = signalCount(bob);
        binary.ws.send(new Uint8Array([1, 2, 3]));
        await bob.wait(m => m.type === 'peer-left' && m.id === binary.welcome.id);
        check(signalCount(bob) === beforeBinary, 'Binary messages must not be relayed');

        const longName = await joined(room, 'N'.repeat(100));
        const longJoined = await alice.wait(m => m.type === 'peer-joined' && m.id === longName.welcome.id);
        check(longJoined.name.length === 48, 'Participant names must be bounded to 48 characters');
        const extras = [];
        while (extras.length < 4) extras.push(await joined(room, 'Extra ' + extras.length));
        const ninth = connect(room, 'Ninth');
        const rejected = await ninth.wait(m => m.type === 'error');
        check(rejected.message.includes('8'), 'The ninth participant must receive the room capacity error');
        check(!ninth.messages.some(m => m.type === 'welcome'), 'A full room must not welcome a ninth participant');
        await Promise.race([ninth.close, new Promise((_, reject) => setTimeout(() => reject(new Error('Full room socket did not close')), 5000))]);
        check(ninth.closeStatus.code === 1008, 'Capacity rejection must deliver its error before a clean policy close');
        const invalidRoom = connect('short', 'Invalid');
        await Promise.race([invalidRoom.close, new Promise((_, reject) => setTimeout(() => reject(new Error('Invalid room was not rejected')), 5000))]);
        check(invalidRoom.messages.length === 0, 'Invalid room IDs must fail before joining');
        return {participants: 3, malformedCases: malformed.length + 1, boundedNames: true, maxPeers: 8};
      } finally {
        for (const client of sockets) { for (const waiter of client.waiters) clearTimeout(waiter.timer); client.ws.close(); }
      }
    });
    assert.deepEqual(results, {participants: 3, malformedCases: 7, boundedNames: true, maxPeers: 8});
    console.log('PASS: three-peer call rooms, ordered joins/leaves, SDP/ICE, trusted sender IDs, room isolation, invalid/oversized/binary rejection, bounded names and 8-peer limit.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
