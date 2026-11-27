(() => {
  'use strict';

  const defaults = { mode: 'time', size: 'normal', bold: false, left: 'none', right: 'none' };
  const sizes = { small: 0.85, normal: 1, large: 1.25, xlarge: 1.5 };
  const slots = [
    ['none', 'Nothing', ''], ['weather', 'Weather', '☀ 31°'], ['battery', 'Battery', '▰ 66%'],
    ['date', 'Date'], ['event', 'Next event', '▦ 14:30'], ['todo', 'Next task', '✓ 16:00'],
    ['time', 'Time'], ['cpu', 'CPU', 'CPU 23%'], ['ram', 'Memory (RAM)', 'RAM 54%'],
    ['world', 'World clock', 'Tokyo 21:00'], ['prayer', 'Next prayer', 'Asr 15:12'],
    ['disk', 'Disk', 'Disk 61%'], ['wifi', 'Wi-Fi signal', 'Wi-Fi 82%'],
    ['net', 'Internet ↓↑', '↓24 M ↑640 K'], ['download', 'Download', '↓24 Mbps'], ['upload', 'Upload', '↑640 Kbps'],
  ];

  function networkRate(bits, compact = false) {
    if (!Number.isFinite(bits)) return '';
    if (bits < 500) return '0';
    if (bits < 999500) return `${Math.round(bits / 1000)}${compact ? ' K' : ' Kbps'}`;
    return `${bits < 9950000 ? (bits / 1000000).toFixed(1) : Math.round(bits / 1000000)}${compact ? ' M' : ' Mbps'}`;
  }

  function time(date, format, timeZone) {
    const options = {hour: 'numeric', minute: '2-digit', timeZone};
    if (format !== 'region') options.hourCycle = format === 'h24' ? 'h23' : 'h12';
    return new Intl.DateTimeFormat(undefined, options).format(date);
  }

  function day(date) {
    return date.toLocaleDateString(undefined, {weekday: 'short', day: 'numeric'});
  }

  function font(height, size) {
    const scale = sizes[size] || 1;
    const natural = Math.max(10, height * 0.38);
    const base = Math.min(14, natural);
    if (scale > 1) return Math.round(Math.min(height * 0.7, natural * scale) * 4) / 4;
    return scale < 1 ? Math.max(9, Math.round(base * scale * 4) / 4) : base;
  }

  window.poniClosedDisplay = {defaults, slots, time, day, font, networkRate};
})();
