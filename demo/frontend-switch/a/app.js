// Demo A: expected frontend. No transaction is submitted.
document.querySelector('#connect').addEventListener('click', async () => {
  const status = document.querySelector('#status');
  if (!window.ethereum) { status.textContent = 'Install a wallet to continue.'; return; }
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    status.textContent = accounts.length ? 'Wallet connected. Demo A loaded.' : 'No account selected.';
  } catch (error) { status.textContent = error.message || 'Wallet connection cancelled.'; }
});
