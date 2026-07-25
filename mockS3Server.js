const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 9000;
const UPLOAD_DIR = path.join(__dirname, 'mock_s3_storage');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Enable CORS for all routes and origins
app.use(cors({
  origin: '*',
  methods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['*'],
  exposedHeaders: ['ETag', 'Content-Length', 'Content-Type']
}));

// Preflight CORS logging
app.options('*', (req, res) => {
  console.log(`[CORS PREFLIGHT] ${req.method} ${req.url} - Handled successfully`);
  res.sendStatus(204);
});

// PUT request to upload file
app.put('*', (req, res) => {
  const filePath = path.join(UPLOAD_DIR, req.url.replace(/\//g, '_'));
  const writeStream = fs.createWriteStream(filePath);
  
  let totalBytes = 0;
  const hash = crypto.createHash('md5');

  req.on('data', (chunk) => {
    totalBytes += chunk.length;
    hash.update(chunk);
    writeStream.write(chunk);
  });

  req.on('end', () => {
    writeStream.end();
    const etag = `"${hash.digest('hex')}"`;
    console.log(`[S3 PUT SUCCESS] URL: ${req.url} | Size: ${totalBytes} bytes | ETag: ${etag}`);
    res.setHeader('ETag', etag);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).send();
  });

  req.on('error', (err) => {
    console.error(`[S3 PUT ERROR]`, err);
    res.status(500).send(err.message);
  });
});

// HEAD request for metadata verification
app.head('*', (req, res) => {
  const filePath = path.join(UPLOAD_DIR, req.url.replace(/\//g, '_'));
  if (!fs.existsSync(filePath)) {
    console.log(`[S3 HEAD 404] Key: ${req.url}`);
    return res.status(404).send();
  }
  const stats = fs.statSync(filePath);
  const fileBuffer = fs.readFileSync(filePath);
  const etag = `"${crypto.createHash('md5').update(fileBuffer).digest('hex')}"`;
  
  console.log(`[S3 HEAD 200] Key: ${req.url} | ContentLength: ${stats.size} | ETag: ${etag}`);
  res.setHeader('Content-Length', stats.size);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('ETag', etag);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).end();
});

// GET request for retrievability check
app.get('*', (req, res) => {
  const filePath = path.join(UPLOAD_DIR, req.url.replace(/\//g, '_'));
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Not Found');
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.sendFile(filePath);
});

app.listen(PORT, () => {
  console.log(`Real-Network Mock S3 Server listening on port ${PORT}`);
});
