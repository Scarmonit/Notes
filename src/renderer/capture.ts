/**
 * The quick-note box. One field, one key: Enter files the text in the Inbox
 * note and the box goes away. Nothing here knows about the notes; the notes
 * window does the filing.
 */

const field = document.getElementById('capture-text') as HTMLTextAreaElement;
const sendBtn = document.getElementById('capture-send') as HTMLButtonElement;
const counter = document.getElementById('capture-status') as HTMLElement;

function send(): void {
  const text = field.value.trim();
  if (!text) {
    void window.captureApi.dismiss();
    return;
  }
  field.value = '';
  counter.textContent = '';
  void window.captureApi.send(text);
}

field.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    send();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    // What was typed is kept for next time: Esc is "not now", not "throw it away".
    void window.captureApi.dismiss();
  }
});

field.addEventListener('input', () => {
  const n = field.value.trim().length;
  counter.textContent = n > 0 ? `${n} ${n === 1 ? 'character' : 'characters'}` : '';
});

sendBtn.addEventListener('click', send);

window.captureApi.onShow(() => {
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
});

field.focus();
