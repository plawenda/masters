// ── Page init ─────────────────────────────────────────────────────────────────
// Called automatically on load. Sets year, loads AI dispatch, wires hamburger.

(function initPage() {
  // Year in subtitle
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // Hamburger menu
  const menuBtn = document.getElementById('menuBtn');
  const navEl = document.querySelector('nav');
  if (menuBtn && navEl) {
    menuBtn.addEventListener('click', e => { e.stopPropagation(); navEl.classList.toggle('open'); });
    document.addEventListener('click', e => {
      if (!navEl.contains(e.target) && e.target !== menuBtn) navEl.classList.remove('open');
    });
  }
})();

// ── Utility functions ─────────────────────────────────────────────────────────

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatMoney(n) {
  if (!n && n !== 0) return '—';
  return '$' + Math.round(n).toLocaleString('en-US');
}

function scoreClass(s) {
  if (!s || s === 'E' || s === '-') return '';
  return s.startsWith('-') ? 'score-neg' : 'score-pos';
}

function renderSparkline(history, currentRank) {
  const ranks = [...(history || []).map(h => h.rank), currentRank].filter(r => r != null);
  if (ranks.length < 2) return '';
  const hi = Math.max(...ranks), lo = Math.min(...ranks), range = hi - lo || 1;
  const W = 64, H = 20, P = 3;
  const pts = ranks.map((r, i) => {
    const x = (P + (i / (ranks.length - 1)) * (W - 2 * P)).toFixed(1);
    const y = (P + ((r - lo) / range) * (H - 2 * P)).toFixed(1);
    return `${x},${y}`;
  });
  const first = ranks[0], last = ranks[ranks.length - 1];
  const color = last < first ? '#22c55e' : last > first ? '#ef4444' : '#94a3b8';
  const [lx, ly] = pts[pts.length - 1].split(',');
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="sparkline-svg" aria-hidden="true">` +
    `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.75"/>` +
    `<circle cx="${lx}" cy="${ly}" r="2" fill="${color}"/>` +
    `</svg>`;
}

function moveBadge(delta) {
  if (!delta) return '—';
  const abs = Math.abs(delta);
  return delta > 0
    ? `<span class="move-up" title="Up ${abs} since start of day">▲${abs}</span>`
    : `<span class="move-down" title="Down ${abs} since start of day">▼${abs}</span>`;
}
