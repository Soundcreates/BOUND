// Hard-coded presentation score, not a BOUND assessment.
const DEMO_SCORE = 85;
const DEMO_THRESHOLD = 16;
const button = document.querySelector('#connect');
const status = document.querySelector('#status');
button.addEventListener('click', async () => {
  if (DEMO_SCORE < DEMO_THRESHOLD) return;
  const injected = window.ethereum;
  const provider = injected?.providers?.find(item => item.isMetaMask) || injected;
  if (!provider?.request) { status.textContent = 'No wallet found. Install or unlock MetaMask, then try again.'; return; }
  button.disabled = true;
  status.textContent = 'Check the BOUND review and your wallet for a connection request.';
  try {
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    status.textContent = accounts.length ? `Wallet connected: ${accounts[0]}.` : 'No account was selected in your wallet.';
  } catch (error) {
    status.textContent = error?.code === -32002 ? 'A wallet request is already pending. Open your wallet to finish it.' : `Connection not completed: ${error?.message || 'check your wallet and try again.'}`;
  } finally { button.disabled = false; }
});
