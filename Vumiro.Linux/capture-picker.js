'use strict';

const list = document.getElementById('sources');
document.getElementById('cancel').addEventListener('click', () => window.capturePicker.cancel());
window.capturePicker.onSources(sources => {
  list.replaceChildren();
  if (!sources.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No screens or windows are available.';
    list.append(empty);
    return;
  }
  for (const source of sources) {
    if (!source || typeof source.id !== 'string' || typeof source.name !== 'string' || typeof source.thumbnail !== 'string') continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'source';
    const thumbnail = document.createElement('img');
    thumbnail.src = source.thumbnail;
    thumbnail.alt = '';
    const label = document.createElement('span');
    label.textContent = source.name;
    button.append(thumbnail, label);
    button.addEventListener('click', () => window.capturePicker.selectSource(source.id));
    list.append(button);
  }
});
