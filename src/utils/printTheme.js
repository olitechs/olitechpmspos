const TOKEN_NAME = /^--[a-z][a-z0-9-]*$/i;

export function getPrintColor(tokenName) {
  const token = tokenName.startsWith('--') ? tokenName : `--${tokenName}`;
  if (!TOKEN_NAME.test(token)) throw new Error(`Invalid CSS color token: ${tokenName}`);
  if (typeof document === 'undefined') return `var(${token})`;

  const probe = document.createElement('span');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;color:var(${token});`;
  const host = document.body || document.documentElement;
  host.appendChild(probe);
  const resolved = window.getComputedStyle(probe).color;
  probe.remove();
  return resolved || `var(${token})`;
}
