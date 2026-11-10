(() => {
  'use strict';
  const categories = new Set(['friend', 'roomInvite', 'call', 'roomActivity', 'message']);
  function normalize(value) {
    if (!value || typeof value.id !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(value.id) || !categories.has(value.category)) return null;
    const text = typeof value.text === 'string' ? value.text.slice(0, 320) : '';
    if (!text.trim()) return null;
    return { id: value.id, category: value.category, text,
      senderName: typeof value.senderName === 'string' ? value.senderName.slice(0, 80) : 'Vumiro',
      avatar: typeof value.avatar === 'string' && value.avatar.length <= 32768 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.avatar) ? value.avatar : '',
      available: value.available === true };
  }
  function create({ bell, panel, list, empty, count, onOpen = () => {}, onDismiss = () => {}, labels = {} }) {
    if (document.head && !document.querySelector('style[data-vumiro-notifications]')) {
      const style = document.createElement('style'); style.dataset.vumiroNotifications = '';
      style.textContent = `.notificationPanel{position:fixed;z-index:95;right:20px;top:76px;width:min(390px,calc(100vw - 32px));max-height:calc(100vh - 100px);overflow:auto;padding:18px;border:1px solid #ffffff1f;border-radius:18px;background:#18181ef2;backdrop-filter:blur(22px);box-shadow:0 24px 75px #0008;opacity:0;visibility:hidden;transform:translateX(30px);pointer-events:none;transition:transform .24s cubic-bezier(.2,.8,.2,1),opacity .2s,visibility .24s}
.notificationPanel.isOpen{opacity:1;visibility:visible;transform:translateX(0);pointer-events:auto}
.notificationPanel .dialogHead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
.notificationPanel h2{margin:0;font-size:16px}.notificationPanel ol{list-style:none;padding:0;margin:0;display:grid;gap:8px}
.notificationPopups{position:fixed;inset:auto 22px 24px auto;margin:0;border:0;padding:0;background:transparent;overflow:visible;z-index:150;width:min(370px,calc(100vw - 32px));display:grid;gap:10px;pointer-events:none;color:inherit}
.notificationPopups[popover]:not(:popover-open){display:none}
.notificationPopups::backdrop{background:transparent;pointer-events:none}
.notificationCard{display:flex;align-items:center;gap:12px;padding:12px;border:1px solid #ffffff16;border-radius:13px;background:#202028;color:#f8f8fa;min-width:0}
.notificationPopups .notificationCard{pointer-events:auto;box-shadow:0 14px 45px #0007;animation:notificationArrive .28s cubic-bezier(.2,.8,.2,1)}
.notificationAvatar{flex:none;width:42px;height:42px;border-radius:50%;object-fit:cover;display:grid;place-items:center;background:#4b273a;color:#fff;font-weight:700;font-size:18px}
button.notificationBody{display:grid;gap:4px;flex:1;min-width:0;border:0;padding:0;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer}
.notificationBody strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.notificationBody span{font-size:12px;color:#b8b8c6;line-height:1.45;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
button.notificationBody:disabled{opacity:1;cursor:default}.notificationDismiss{align-self:flex-start;border:0;background:transparent;color:#aaaabd;cursor:pointer;padding:0 4px;font-size:20px;line-height:22px}
.notificationBody:focus-visible,.notificationDismiss:focus-visible{outline:2px solid #f06b82;outline-offset:4px;border-radius:4px}
@keyframes notificationArrive{from{opacity:0;transform:translateX(35px)}to{opacity:1;transform:translateX(0)}}
@media(prefers-reduced-motion:reduce){.notificationPanel{transition:none}.notificationPopups .notificationCard{animation:none}}
`; document.head.append(style);
    }
    const listeners = [], visible = new Map(), seen = new Set();
    let opened = false, items = [];
    const stack = document.createElement('div');
    stack.className = 'notificationPopups'; stack.setAttribute('aria-live', 'polite'); stack.setAttribute('aria-relevant', 'additions');
    if (typeof stack.showPopover === 'function') stack.setAttribute('popover', 'manual');
    document.body.append(stack);
    // A modal makes nodes outside its subtree inert. Keep the nonmodal toast
    // stack inside the current modal, then lift it above that modal in the top layer.
    let modalOrder = [];
    function placePopups(records = []) {
      const modals = [...document.querySelectorAll('dialog:modal')];
      modalOrder = modalOrder.filter(node => modals.includes(node));
      for (const record of records) if (record.type === 'attributes' && modals.includes(record.target)) {
        modalOrder = modalOrder.filter(node => node !== record.target); modalOrder.push(record.target);
      }
      for (const node of modals) if (!modalOrder.includes(node)) modalOrder.push(node);
      const parent = modalOrder.at(-1) || document.body;
      if (stack.parentNode !== parent) {
        if (stack.matches?.(':popover-open')) stack.hidePopover();
        parent.append(stack);
      }
      if (visible.size && stack.showPopover && !stack.matches(':popover-open')) stack.showPopover();
      else if (!visible.size && stack.matches?.(':popover-open')) stack.hidePopover();
    }
    const modalObserver = new MutationObserver(placePopups);
    modalObserver.observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['open']});
    panel.classList.add?.('notificationPanel');
    panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', labels.title || 'Notifications');
    panel.setAttribute('tabindex', '-1');
    panel.hidden = false;
    if (!panel.id) panel.id = 'notificationPanel';
    bell.setAttribute('aria-controls', panel.id); bell.setAttribute('aria-expanded', 'false');
    bell.setAttribute('aria-haspopup', 'true');
    function listen(node, type, callback) { node.addEventListener(type, callback); listeners.push(() => node.removeEventListener(type, callback)); }
    function positionPanel() {
      if (!opened) return;
      const top = Math.max(8, Math.ceil(bell.getBoundingClientRect().bottom) + 12);
      panel.style.top = top + 'px'; panel.style.maxHeight = Math.max(0, window.innerHeight - top - 12) + 'px';
    }
    function open() { opened = true; positionPanel(); panel.hidden = false; panel.classList.toggle('isOpen', true); panel.setAttribute('aria-hidden', 'false'); bell.setAttribute('aria-expanded', 'true'); }
    function close(restoreFocus = false) { opened = false; panel.classList.toggle('isOpen', false); panel.setAttribute('aria-hidden', 'true'); panel.inert = true; bell.setAttribute('aria-expanded', 'false'); if (restoreFocus) bell.focus(); }
    function show() { panel.inert = false; open(); }
    function removePopup(id) { const entry = visible.get(id); if (!entry) return; clearTimeout(entry.timer); entry.node.remove(); visible.delete(id); placePopups(); }
    function row(item, popup) {
      const node = document.createElement(popup ? 'article' : 'li'); node.className = 'notificationCard'; node.dataset.notificationId = item.id;
      let avatar;
      if (item.avatar) { avatar = document.createElement('img'); avatar.src = item.avatar; avatar.alt = ''; avatar.addEventListener('error', () => { avatar.removeAttribute?.('src'); }); }
      else { avatar = document.createElement('span'); avatar.textContent = (item.senderName.trim()[0] || 'V').toUpperCase(); avatar.setAttribute('aria-hidden', 'true'); }
      avatar.className = 'notificationAvatar';
      const body = document.createElement('button'); body.type = 'button'; body.className = 'notificationBody';
      const name = document.createElement('strong'), text = document.createElement('span'); name.textContent = item.senderName; text.textContent = item.text; body.append(name, text);
      name.setAttribute('translate', 'no');
      if(item.category === 'message')text.setAttribute('translate', 'no');
      body.disabled = !item.available; body.addEventListener('click', () => { if (item.available) { removePopup(item.id); close(); onOpen(item.id); } });
      const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.className = 'notificationDismiss'; dismiss.textContent = '×';
      dismiss.setAttribute('aria-label', labels.dismiss || 'Dismiss notification');
      dismiss.addEventListener('click', event => { event.stopPropagation(); removePopup(item.id); onDismiss(item.id); });
      node.append(avatar, body, dismiss); return node;
    }
    function sync(values) {
      items = (Array.isArray(values) ? values : []).slice(0, 64).map(normalize).filter(Boolean);
      list.replaceChildren(...items.map(item => row(item, false))); empty.hidden = items.length > 0;
      if (count) { count.textContent = String(items.length); count.hidden = !items.length; }
      bell.setAttribute('aria-label', (labels.title || 'Notifications') + (items.length ? ': ' + items.length : ''));
      for (const [id, entry] of visible) {
        const item = items.find(value => value.id === id);
        // sync also removes stale action affordances without keeping event closures alive.
        if (!item) removePopup(id);
        else { entry.item.available = item.available; entry.node.children[1].disabled = !item.available; }
      }
    }
    function popup(value) {
      const item = normalize(value); if (!item || seen.has(item.id)) return false;
      seen.add(item.id); if (seen.size > 256) seen.delete(seen.values().next().value);
      while (visible.size >= 3) removePopup(visible.keys().next().value);
      const node = row(item, true), entry = {node, item, timer: null};
      function expire() { clearTimeout(entry.timer); entry.timer = setTimeout(() => removePopup(item.id), item.category === 'call' ? 12000 : 7000); }
      node.addEventListener('pointerenter', () => clearTimeout(entry.timer)); node.addEventListener('pointerleave', expire);
      node.addEventListener('focusin', () => clearTimeout(entry.timer)); node.addEventListener('focusout', expire);
      visible.set(item.id, entry); stack.append(node); placePopups(); expire(); return true;
    }
    function clear() { for (const id of [...visible.keys()]) removePopup(id); seen.clear(); sync([]); close(); }
    listen(bell, 'click', () => { if (opened) close(); else show(); });
    listen(bell, 'keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); show(); panel.focus(); } });
    listen(document, 'keydown', event => { if (event.key === 'Escape' && opened) { event.preventDefault(); close(true); } });
    listen(document, 'pointerdown', event => { if (opened && !bell.contains(event.target) && !panel.contains(event.target)) close(); });
    listen(window, 'resize', positionPanel);
    listen(document, 'scroll', positionPanel);
    const bellObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(positionPanel) : null;
    bellObserver?.observe(bell);
    close();
    return Object.freeze({sync, popup, open: show, close, clear,
      destroy: () => { modalObserver.disconnect(); bellObserver?.disconnect(); clear(); listeners.forEach(remove => remove()); stack.remove(); }});
  }
  window.VumiroNotificationCenter = Object.freeze({create, normalize});
})();
