// Hard-coded presentation score, not a BOUND assessment or incident record.
const DEMO_SCORE = 10;
const DEMO_THRESHOLD = 16;
const SWARM_SAFE_PAGE = 'https://bzz.limo/bzz/fa43f135f708b18f7f97008971e977f8ac74385f9f7237fb58bdc20ad2ba14ef/';
const button = document.querySelector('#connect');
const status = document.querySelector('#status');
button.addEventListener('click', () => {
  if (DEMO_SCORE < DEMO_THRESHOLD) {
    status.textContent = 'Opening the safe page…';
    const report = { origin: window.location.origin, score: DEMO_SCORE, time: new Date().toISOString() };
    window.location.assign(SWARM_SAFE_PAGE + '#presentation=' + encodeURIComponent(JSON.stringify(report)));
  }
});
