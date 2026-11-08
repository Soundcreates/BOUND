export const validTicketHash = hash => /^#[0-9a-f]{32}$/.test(hash) ? hash.slice(1) : null;
export const phraseMatches = value => value === 'I UNDERSTAND';
export function renderDisplay(element, display) {
  element.textContent = JSON.stringify(display, null, 2);
}
export async function initializeConfirmation({window, document, sendMessage}) {
  if (window.self !== window.top) return false;
  const ticket = validTicketHash(window.location.hash);
  if (!ticket) return false;
  const result = await sendMessage({type:'BOUND_TICKET_GET_V1',ticket});
  if (!result?.ok) return false;
  const display = document.getElementById('display'), input = document.getElementById('phrase'), button = document.getElementById('continue');
  renderDisplay(display,result.display);
  let submitted = false;
  input.addEventListener('input', () => {button.disabled = submitted || !phraseMatches(input.value);});
  button.addEventListener('click', async () => { if (submitted || window.self !== window.top || !phraseMatches(input.value)) return; submitted=true; button.disabled=true; try { await sendMessage({type:'BOUND_TICKET_APPROVE_V1',ticket,phrase:input.value}); } catch {} });
  return true;
}
if (typeof window !== 'undefined' && typeof chrome !== 'undefined') {
  document.getElementById('cancel').addEventListener('click', () => { window.close(); window.location.replace('about:blank'); });
  initializeConfirmation({window,document,sendMessage: message => chrome.runtime.sendMessage(message)}).catch(() => {});
}
