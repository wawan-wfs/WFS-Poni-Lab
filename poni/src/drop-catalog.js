(() => {
  'use strict';

  const zip = /\.zip$/i;
  const photo = /\.(png|jpe?g|jfif|webp|bmp|tiff?)$/i;
  const conversion = /\.(png|jpe?g|jfif)$/i;
  const video = /\.(mp4|m4v|mov|wmv|avi|mkv|webm|3gp|3g2|mts|m2ts|ts|mpg|mpeg)$/i;

  window.poniDropCatalog = [
    {id: 'shelf', label: 'Shelf', icon: '▰', description: 'Keep files on Poni’s Shelf'},
    {id: 'share', label: 'Share', icon: '⇧', description: 'Windows Share: Nearby sharing, Mail, apps'},
    {id: 'zip', label: 'ZIP', icon: '▣', description: 'Make a ZIP next to the files'},
    {id: 'shrink_pdf', label: 'Shrink PDF', icon: '▧', description: 'Make the pictures in a PDF smaller in a copy next to it',
      accepts: paths => paths.every(path => /\.pdf$/i.test(path))},
    {id: 'shrink_image', label: 'Shrink image', icon: '▧', description: 'Make photos smaller in a copy next to each',
      accepts: paths => paths.every(path => photo.test(path))},
    {id: 'shrink_video', label: 'Shrink video', icon: '▶', description: 'Make a smaller MP4 next to the original',
      accepts: paths => paths.every(path => video.test(path))},
    {id: 'extract', label: 'Extract', icon: '⇩', description: 'Extract ZIP files into folders',
      accepts: paths => paths.every(path => zip.test(path))},
    {id: 'convert', label: 'Convert', icon: '⇄', description: 'Convert between PNG and JPG next to the original',
      accepts: paths => paths.every(path => conversion.test(path))},
    {id: 'ocr', label: 'Text from image', icon: 'Aa', description: 'Copy the text in a picture',
      accepts: paths => paths.every(path => photo.test(path))},
    {id: 'copy', label: 'Copy', icon: '▤', description: 'Copy into a folder you pick'},
    {id: 'move', label: 'Move', icon: '↳', description: 'Move into a folder you pick'},
    {id: 'onedrive', label: 'OneDrive', icon: '☁', description: 'Copy into the Poni folder in OneDrive'},
    {id: 'open_with', label: 'Open with', icon: '↗', description: 'Choose an app to open a file',
      accepts: paths => paths.length === 1},
    {id: 'recycle', label: 'Trash', icon: '♜', description: 'Send items to the Windows Recycle Bin'},
    {id: 'eject', label: 'Eject', icon: '⏏', description: 'Safely remove a drive dropped from This PC',
      accepts: paths => paths.length === 1 && /^[a-z]:[\\/]$/i.test(paths[0])},
  ];
})();
