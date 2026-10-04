/** The browser URL is an invitation. The conversation lives in the recipient's BB. */
export const viewerHtml = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Session invitation · BB</title><style>
:root{color-scheme:dark;font:15px/1.6 system-ui,sans-serif;background:#20202f;color:#e6e5f0}*{box-sizing:border-box}
body{min-height:100vh;margin:0;display:grid;place-items:center;padding:32px}.card{max-width:460px;width:100%}
.brand{font-size:13px;color:#a5a3b8;margin-bottom:32px}h1{font-size:28px;font-weight:550;letter-spacing:-.6px;line-height:1.2}
p,ol{color:#aeacc0}ol{padding-left:22px}li{padding:6px 0}button{margin-top:24px;padding:11px 18px;background:#d7d4ee;color:#20202f;border:0;border-radius:8px;font:500 14px system-ui;cursor:pointer}button:focus-visible{outline:2px solid white;outline-offset:4px}small{display:block;margin-top:24px;color:#9693aa}
</style><main class="card"><div class="brand">BB / SESSION PORTAL</div><h1>Open this session in your BB.</h1>
<p>A teammate has invited you to follow their session live.</p><ol><li>Open <strong>Shared sessions</strong> in your BB sidebar.</li><li>Paste this invitation and choose <strong>Connect session</strong>.</li></ol>
<button id="copy">Copy invitation</button><p id="status" role="status"></p><small>Both instances need the Session Share plugin. The owner can stop sharing at any time.</small></main><script src="./viewer.js" defer></script></html>`;
export const viewerScript = `document.getElementById('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.href); document.getElementById('status').textContent = 'Copied. Paste it into Shared sessions in your BB.'; }
  catch { document.getElementById('status').textContent = 'Copy the full address from your browser, including the part after #.'; }
});`;
