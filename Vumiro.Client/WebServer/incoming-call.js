(() => {
  'use strict';
  const rasterAvatar = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
  function normalize(value, now) {
    if (!value || typeof value.id !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(value.id) || !Number.isFinite(value.expires) || value.expires <= now) return null;
    return {id: value.id, expires: value.expires, busy: value.busy === true,
      senderName: typeof value.senderName === 'string' && value.senderName.trim() ? value.senderName.slice(0, 80) : 'Your friend',
      avatar: typeof value.avatar === 'string' && value.avatar.length <= 32768 && rasterAvatar.test(value.avatar) ? value.avatar : ''};
  }
  function create({onAccept = () => false, onReject = () => false, onError = () => {}, now = Date.now, isCurrent = () => true, canRing = () => true, ring = () => {}} = {}) {
    if (document.head && !document.querySelector('style[data-vumiro-incoming-call]')) {
      const style = document.createElement('style'); style.dataset.vumiroIncomingCall = '';
      style.textContent = `.incomingCallSurface{position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;box-sizing:border-box;display:grid;place-items:center;padding:24px;margin:0;border:0;background:#131112b3;color:var(--text,#f6f0eb);overflow:visible;z-index:180;pointer-events:auto}
.incomingCallSurface[hidden]{display:none}.incomingCallSurface[data-presentation=compact]{inset:auto 24px 24px auto;width:min(352px,calc(100vw - 32px));height:auto;padding:0;background:transparent;pointer-events:none}
.incomingCallSurface[data-busy=true]{visibility:hidden;pointer-events:none}
.incomingCallSurface[popover]:not(:popover-open){display:none}.incomingCallSurface::backdrop{background:transparent;pointer-events:none}
.incomingCallCard{box-sizing:border-box;width:min(352px,100%);max-height:calc(100vh - 48px);overflow:auto;pointer-events:auto;display:flex;flex-direction:column;align-items:center;text-align:center;padding:26px 24px 22px;border:1px solid var(--line,#ffffff13);border-radius:20px;background:var(--surface,#1a1718);box-shadow:0 24px 80px #0009;animation:incomingCallArrive .24s ease-out;font:14px system-ui,sans-serif}
.incomingCallSurface[data-presentation=compact] .incomingCallCard{padding:18px}.incomingCallSurface[data-presentation=compact] .incomingCallAvatar{width:52px;height:52px;font-size:20px}.incomingCallSurface[data-presentation=compact] .incomingCallName{margin-top:14px;font-size:18px}.incomingCallSurface[data-presentation=compact] .incomingCallActions{margin-top:18px}
.incomingCallAvatar{width:76px;height:76px;flex:none;border-radius:50%;object-fit:cover;display:grid;place-items:center;background:var(--raised,#262122);color:var(--text,#f6f0eb);font-size:26px;font-weight:700;box-shadow:0 0 0 6px #ffffff12;animation:incomingCallPulse 2.6s ease-out infinite}
.incomingCallName{max-width:100%;margin-top:20px;font-size:20px;font-weight:700;overflow-wrap:anywhere;line-height:1.3}.incomingCallHint{margin-top:6px;color:var(--muted,#b0a6a4);font-size:13px}
.incomingCallActions{display:flex;gap:12px;width:100%;margin-top:24px}.incomingCallActions button{flex:1;min-height:44px;border:0;border-radius:11px;font:600 14px system-ui,sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;color:#fff;padding:10px 12px}
button.incomingCallAccept{background:#26834c}button.incomingCallAccept:hover{background:#31985b}button.incomingCallReject{background:#c23d52}button.incomingCallReject:hover{background:#d84b61}.incomingCallActions button:disabled{opacity:.6;cursor:wait}.incomingCallActions button:focus-visible{outline:3px solid var(--accent,#e31c29);outline-offset:3px}.incomingCallActions svg{width:19px;height:19px;fill:currentColor}.incomingCallCard[aria-busy=true] .incomingCallAvatar{animation:none}
@keyframes incomingCallArrive{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}@keyframes incomingCallPulse{0%{box-shadow:0 0 0 6px #ffffff18}65%,100%{box-shadow:0 0 0 16px #ffffff00}}
@media(prefers-reduced-motion:reduce){.incomingCallCard,.incomingCallAvatar{animation:none}}@media(max-width:480px){.incomingCallSurface[data-presentation=compact]{right:16px;bottom:16px}}`;
      document.head.append(style);
    }
    const surface = document.createElement('div'); surface.className = 'incomingCallSurface'; surface.hidden = true;
    if (typeof surface.showPopover === 'function') surface.setAttribute('popover', 'manual');
    document.body.append(surface);
    let current = null, ringTimer = 0, expiryTimer = 0, stopCue = null, modalOrder = [], destroyed = false, minimized = false;
    function report(error) { try { onError(error); } catch {} }
    function stopRinging() {
      clearTimeout(ringTimer); ringTimer = 0;
      const stop = stopCue; stopCue = null;
      if (typeof stop === 'function') { try { stop(); } catch {} }
    }
    function clear() {
      const previous = current;
      current = null; stopRinging(); clearTimeout(expiryTimer); expiryTimer = 0;
      surface.replaceChildren(); surface.hidden = true;
      if (surface.matches?.(':popover-open')) surface.hidePopover();
      if (previous?.node.contains?.(document.activeElement) && previous.previousFocus?.isConnected) previous.previousFocus.focus();
    }
    function available(entry) { return current === entry && entry.item.expires > now() && isCurrent(entry.item.id); }
    function place(records = []) {
      if (!current) return;
      const modals = [...document.querySelectorAll('dialog:modal')];
      modalOrder = modalOrder.filter(node => modals.includes(node));
      for (const record of records) if (record.type === 'attributes' && modals.includes(record.target)) {
        modalOrder = modalOrder.filter(node => node !== record.target); modalOrder.push(record.target);
      }
      for (const modal of modals) if (!modalOrder.includes(modal)) modalOrder.push(modal);
      const parent = modalOrder.at(-1) || document.body;
      if (surface.parentNode !== parent) {
        if (surface.matches?.(':popover-open')) surface.hidePopover();
        parent.append(surface);
      }
      if (surface.showPopover && !surface.matches(':popover-open')) surface.showPopover();
    }
    function pulse(entry) {
      if (!available(entry) || entry.busy || entry.item.busy || !canRing()) { stopRinging(); return; }
      stopRinging();
      try {
        const cue = ring();
        if (typeof cue === 'function') stopCue = cue;
        else if (cue && typeof cue.then === 'function') Promise.resolve(cue).catch(() => {});
      } catch {}
      ringTimer = setTimeout(() => { ringTimer = 0; if (available(entry)) pulse(entry); else if (current === entry) clear(); }, 2600);
    }
    function refresh() {
      const entry = current; if (!entry) return;
      if (!available(entry)) { clear(); return; }
      const busy = entry.busy || entry.item.busy;
      const wasBusy = surface.dataset.busy === 'true'; surface.dataset.busy = String(busy); surface.setAttribute('aria-hidden', String(busy));
      entry.accept.disabled = entry.reject.disabled = busy; entry.node.setAttribute('aria-busy', String(busy));
      const presentation = !minimized && document.visibilityState !== 'hidden' && (!document.hasFocus || document.hasFocus()) ? 'center' : 'compact';
      const changed = surface.dataset.presentation !== presentation; surface.dataset.presentation = presentation;
      entry.node.setAttribute('aria-modal', String(presentation === 'center'));
      if (busy || !canRing()) stopRinging(); else if (!ringTimer) pulse(entry);
      place();
      if (presentation === 'center' && (changed || wasBusy) && !busy) entry.accept.focus();
    }
    function initials(name) { return name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0] || '').join('').toUpperCase(); }
    function avatar(item) {
      const fallback = () => { const node = document.createElement('span'); node.className = 'incomingCallAvatar'; node.textContent = initials(item.senderName); node.setAttribute('aria-hidden', 'true'); return node; };
      if (!item.avatar) return fallback();
      const image = document.createElement('img'); image.className = 'incomingCallAvatar'; image.alt = '';
      image.addEventListener('error', () => { if (image.parentNode) image.parentNode.replaceChild(fallback(), image); });
      image.src = item.avatar; return image;
    }
    function button(label, className, path) {
      const node = document.createElement('button'); node.type = 'button'; node.className = className;
      // Fixed markup contains only the handset icon; caller data always uses textContent.
      const icon = document.createElement('span'); icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = '<svg viewBox="0 0 24 24"><path d="' + path + '"/></svg>';
      const text = document.createElement('span'); text.textContent = label; node.append(icon, text);
      node.setAttribute('aria-label', label + ' call'); return node;
    }
    async function activate(entry, accepted) {
      if (!available(entry) || entry.busy || entry.item.busy) return;
      entry.busy = true; refresh();
      let result = false;
      try { result = await (accepted ? onAccept(entry.item.id) : onReject(entry.item.id)); }
      catch (error) { report(error); }
      if (current !== entry) return;
      if (result !== false) clear(); else { entry.busy = false; refresh(); }
    }
    function show(value) {
      if (destroyed) return false;
      const item = normalize(value, now()); if (!item || !isCurrent(item.id)) { clear(); return false; }
      if (current?.item.id === item.id && current.item.expires === item.expires) { current.item = item; refresh(); return true; }
      clear();
      const node = document.createElement('section'); node.className = 'incomingCallCard'; node.dataset.callId = item.id;
      node.setAttribute('role', 'dialog'); node.setAttribute('aria-label', 'Incoming call');
      const name = document.createElement('strong'); name.className = 'incomingCallName'; name.textContent = item.senderName; name.setAttribute('translate', 'no');
      const hint = document.createElement('span'); hint.className = 'incomingCallHint'; hint.textContent = 'Incoming call'; hint.setAttribute('role', 'status');
      const actions = document.createElement('div'); actions.className = 'incomingCallActions';
      const reject = button('Reject', 'incomingCallReject', 'M12 8c-4.4 0-8.4 1.8-11 4.8l3.3 3.3 3-1.5V12a12 12 0 0 1 9.4 0v2.6l3 1.5 3.3-3.3C20.4 9.8 16.4 8 12 8Z');
      const accept = button('Accept', 'incomingCallAccept', 'M6.6 2 3 3.5C1.6 4.1 3 11 7.5 15.5S19.9 22.4 20.5 21l1.5-3.6-5-2-1.8 2C12 16 8 12 6.6 8.8l2-1.8-2-5Z');
      const entry = current = {item, node, accept, reject, busy: false, previousFocus: document.activeElement};
      accept.addEventListener('click', () => { void activate(entry, true); }); reject.addEventListener('click', () => { void activate(entry, false); });
      actions.append(reject, accept); node.append(avatar(item), name, hint, actions); surface.append(node); surface.hidden = false; delete surface.dataset.presentation;
      expiryTimer = setTimeout(() => { if (current === entry) clear(); }, Math.max(1, item.expires - now()));
      refresh(); return true;
    }
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(place) : null;
    observer?.observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['open']});
    function keydown(event) {
      if (!current || current.busy || current.item.busy || surface.dataset.presentation !== 'center' || event.key !== 'Tab') return;
      event.preventDefault();
      if (current.accept.disabled) return;
      (document.activeElement === current.reject ? current.accept : document.activeElement === current.accept ? current.reject : event.shiftKey ? current.accept : current.reject).focus();
    }
    document.addEventListener('keydown', keydown);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh); window.addEventListener('blur', refresh);
    window.addEventListener('pagehide', clear);
    return Object.freeze({show, clear, refresh, focus: () => { refresh(); current?.accept.focus(); }, setWindowState: state => { minimized = state?.minimized === true; refresh(); },
      destroy() { destroyed = true; observer?.disconnect(); document.removeEventListener('keydown', keydown); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh); window.removeEventListener('blur', refresh); window.removeEventListener('pagehide', clear); clear(); surface.remove(); }});
  }
  window.VumiroIncomingCall = Object.freeze({create});
})();
