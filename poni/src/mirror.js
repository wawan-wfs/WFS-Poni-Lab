(() => {
  'use strict';

  let tile;
  let button;
  let video;
  let label;
  let icon;
  let stream;
  let enabled = true;
  let shape = 'rounded';
  let requestId = 0;
  let opening = false;

  function showState(text) {
    const live = Boolean(stream);
    button.classList.toggle('mirror-live', live);
    button.setAttribute('aria-pressed', String(live));
    button.title = live ? 'Turn off camera' : opening ? 'Cancel camera request' : 'Turn on camera';
    label.textContent = text;
    icon.hidden = live;
  }

  function stopTracks(current) {
    current?.getTracks().forEach(track => track.stop());
  }

  function hide(message = 'Mirror') {
    requestId++;
    opening = false;
    const current = stream;
    stream = null;
    stopTracks(current);
    if (video) {
      video.srcObject = null;
      showState(message);
    }
  }

  async function showPreview() {
    const id = ++requestId;
    opening = true;
    showState('Opening camera…');
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        hide('No camera');
        return;
      }
      const current = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 320, facingMode: 'user' },
        audio: false,
      });
      if (id !== requestId) {
        stopTracks(current);
        return;
      }
      const camera = current.getVideoTracks().find(track => track.readyState === 'live');
      if (!camera) {
        stopTracks(current);
        hide('No camera');
        return;
      }
      stream = current;
      camera.addEventListener('ended', () => {
        if (stream === current) hide('No camera');
      }, { once: true });
      video.srcObject = current;
      showState('Camera on');
      await video.play();
    } catch (error) {
      if (id === requestId) {
        hide(error?.name === 'NotAllowedError' ? 'Camera access denied' : 'No camera');
      }
    } finally {
      if (id === requestId) opening = false;
    }
  }

  function configure(preferences = {}) {
    if (typeof preferences.enabled === 'boolean') enabled = preferences.enabled;
    if (preferences.shape === 'rounded' || preferences.shape === 'circle') shape = preferences.shape;
    if (!enabled) hide();
    if (!tile) return;
    tile.hidden = !enabled;
    tile.parentElement?.classList.toggle('home-with-mirror', enabled);
    button.classList.toggle('mirror-circle', shape === 'circle');
  }

  function mount(element) {
    if (!element || tile) return;
    tile = element;
    tile.innerHTML = `
      <button type="button" class="mirror-tile" aria-label="Mirror" aria-pressed="false">
        <video class="mirror-video" muted autoplay playsinline aria-hidden="true"></video>
        <span class="mirror-idle">
          <span class="mirror-icon" aria-hidden="true"></span>
          <span class="mirror-state" role="status">Mirror</span>
        </span>
      </button>
    `;
    button = tile.querySelector('button');
    video = tile.querySelector('video');
    icon = tile.querySelector('.mirror-icon');
    label = tile.querySelector('.mirror-state');
    video.muted = true;
    button.addEventListener('click', () => {
      if (opening || stream) hide();
      else if (enabled) void showPreview();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) hide();
    });
    window.addEventListener('pagehide', () => hide());
    showState('Mirror');
    configure();
  }

  window.poniMirror = { mount, configure, hide };
})();
