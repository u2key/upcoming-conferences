'use strict';

document.addEventListener('DOMContentLoaded', () => {
  window.UCCommon.renderNavAuth();
  // Show examples with this site's real address
  document.querySelectorAll('[data-with-origin]').forEach((el) => {
    el.textContent = el.textContent.replace('{origin}', location.origin);
  });
});
