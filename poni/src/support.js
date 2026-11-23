(() => {
  'use strict';

  const modules = window.poniModules ||= {};
  modules.support = {
    mount(page) {
      page.innerHTML = `
        <div class="poni-support">
          <div>
            <strong>Support the original Poni</strong>
            <p>Poni is made by Bos Digital.</p>
            <div class="poni-support-links">
              <button type="button" data-link="paypal">Support on PayPal</button>
              <button type="button" data-link="github">Star Poni on GitHub</button>
            </div>
            <p class="poni-support-status" role="status"></p>
          </div>
        </div>`;
      const status = page.querySelector('.poni-support-status');
      for (const button of page.querySelectorAll('[data-link]')) {
        button.addEventListener('click', async () => {
          status.textContent = '';
          try {
            await window.__TAURI__.core.invoke('open_support_link', {destination: button.dataset.link});
          } catch (error) {
            status.textContent = String(error);
          }
        });
      }
    },
  };
})();
