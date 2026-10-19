pdf.min.js e pdf.worker.min.js: PDF.js 3.11.174 (build "legacy", Mozilla, licenza Apache 2.0),
da pdfjs-dist@3.11.174. Servono solo a leggere il testo delle bolle in PDF (js/bolla-pdf.js)
e vengono caricati solo quando si apre un PDF.

qrcode.js: QR Code Generator for JavaScript 1.4.4 (Kazuhiko Arase, licenza MIT), da qrcode-generator@1.4.4.
Disegna il QR delle etichette di fusti e cartoni (js/qr.js); si carica solo quando si apre un'etichetta.

jsQR.js: jsQR 1.4.0 (Cosmo Wolfe, licenza Apache 2.0), da jsqr@1.4.0. Legge i QR dalla fotocamera
sui telefoni senza BarcodeDetector (iPhone); si carica solo quando si apre "Scansiona".
