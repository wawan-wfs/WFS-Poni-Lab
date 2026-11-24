'use strict';

const params = new URLSearchParams(location.search);
const session = params.get('session');
const duration = Number(params.get('duration'));
const end = performance.now() + (duration >= 10 && duration <= 60 ? duration : 20) * 1000;
const count = document.querySelector('#count');
let closing = false;
let timeout;

async function closeBreak() {
  if (closing) return;
  closing = true;
  clearTimeout(timeout);
  try {
    await window.__TAURI__.core.invoke('dismiss_eye_break', { session });
  } catch {
    closing = false;
  }
}

function tickBreak() {
  const seconds = Math.max(0, Math.ceil((end - performance.now()) / 1000));
  count.textContent = seconds;
  if (seconds === 0) {
    void closeBreak();
  } else {
    timeout = setTimeout(tickBreak, 100);
  }
}

document.querySelector('#skip').addEventListener('click', closeBreak);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') void closeBreak();
});
tickBreak();
