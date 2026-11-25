(() => {
  'use strict';

  const zip = /\.zip$/i;
  const photo = /\.(png|jpe?g|jfif|webp|bmp|tiff?)$/i;
  const conversion = /\.(png|jpe?g|jfif)$/i;

  window.poniDropCatalog = [
    {id: 'shelf', label: 'Shelf', icon: '▰', description: 'Keep files on Poni’s Shelf'},
    {id: 'zip', label: 'ZIP', icon: '▣', description: 'Make a ZIP next to the files'},
    {id: 'shrink_image', label: 'Shrink image', icon: '▧', description: 'Make photos smaller in a copy next to each',
      accepts: paths => paths.every(path => photo.test(path))},
    {id: 'extract', label: 'Extract', icon: '⇩', description: 'Extract ZIP files into folders',
      accepts: paths => paths.every(path => zip.test(path))},
    {id: 'convert', label: 'Convert', icon: '⇄', description: 'Convert between PNG and JPG next to the original',
      accepts: paths => paths.every(path => conversion.test(path))},
    {id: 'copy', label: 'Copy', icon: '▤', description: 'Copy into a folder you pick'},
  ];
})();
