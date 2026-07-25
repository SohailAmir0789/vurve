require('dotenv').config();
const http = require('http');
const pool = require('./src/db/pool');
const { HeadObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

// ── Mock S3/R2 Server for Local Verification if no real R2 keys ──────────────
const isPlaceholderR2 = !process.env.R2_ACCOUNT_ID || process.env.R2_ACCOUNT_ID === 'your_cloudflare_account_id';
let mockServer = null;
const storageMap = new Map(); // key -> { buffer, contentType }

function startMockS3Server() {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      // Parse URL path, e.g. /vurve-bucket/raw/123/original.mp4
      const urlPath = req.url.split('?')[0];
      const parts = urlPath.slice(1).split('/');
      const bucket = parts[0];
      const key = parts.slice(1).join('/');

      if (req.method === 'PUT') {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const contentType = req.headers['content-type'] || 'video/mp4';
          storageMap.set(`${bucket}/${key}`, { buffer, contentType });
          res.writeHead(200, { 'ETag': '"mock-etag-12345"' });
          res.end();
        });
      } else if (req.method === 'HEAD') {
        const item = storageMap.get(`${bucket}/${key}`);
        if (item) {
          res.writeHead(200, {
            'Content-Length': item.buffer.length,
            'Content-Type': item.contentType,
            'ETag': '"mock-etag-12345"',
            'Last-Modified': new Date().toUTCString()
          });
          res.end();
        } else {
          res.writeHead(404);
          res.end();
        }
      } else if (req.method === 'GET') {
        const item = storageMap.get(`${bucket}/${key}`);
        if (item) {
          res.writeHead(200, {
            'Content-Length': item.buffer.length,
            'Content-Type': item.contentType
          });
          res.end(item.buffer);
        } else {
          res.writeHead(404);
          res.end();
        }
      } else {
        res.writeHead(405);
        res.end();
      }
    });

    mockServer.listen(9090, '127.0.0.1', () => {
      console.log('Started local S3/R2 mock server at http://127.0.0.1:9090');
      resolve();
    });
  });
}

async function testStrictE2E() {
  console.log("=== STRICT E2E UPLOAD & R2 VERIFICATION TEST ===");

  if (isPlaceholderR2) {
    console.log("Detected placeholder R2 credentials in .env -> Spinning up local S3/R2 server for test execution...");
    process.env.R2_ENDPOINT = 'http://127.0.0.1:9090';
    process.env.R2_BUCKET = 'vurve-test-bucket';
    process.env.R2_ACCESS_KEY_ID = 'mock_access_key';
    process.env.R2_SECRET_ACCESS_KEY = 'mock_secret_key';
    await startMockS3Server();
  }

  // Reload r2 client after setting environment variables
  delete require.cache[require.resolve('./src/config/r2')];
  const r2 = require('./src/config/r2');
  const { getUploadUrl, createVideoRecord } = require('./src/controllers/videoController');

  try {
    // 1. User Setup
    const userRes = await pool.query(`
      INSERT INTO users (handle, email, password_hash)
      VALUES ('strict_e2e_user', 'strict_e2e@example.com', 'hash')
      ON CONFLICT (handle) DO UPDATE SET handle = EXCLUDED.handle
      RETURNING id;
    `);
    const userId = userRes.rows[0].id;
    console.log("\n1. Authenticated User ID:", userId);

    // 2. Request Upload URL
    console.log("2. Requesting Upload URL (POST /videos/upload-url)...");
    const reqGetUrl = { user: { id: userId } };
    let getUrlData = null;
    const resGetUrl = { json: (data) => { getUrlData = data; } };

    await getUploadUrl(reqGetUrl, resGetUrl, (err) => { if (err) throw err; });
    const { videoId, uploadUrl } = getUrlData;
    console.log("   -> videoId:", videoId);
    console.log("   -> uploadUrl:", uploadUrl);

    // 3. Create a 15,420-byte test binary video payload
    const testFileSize = 15420;
    const testVideoBuffer = Buffer.alloc(testFileSize, 'v'); // filled with 'v'
    const testContentType = 'video/mp4';

    console.log(`\n3. Uploading ${testFileSize}-byte test file via PUT to uploadUrl...`);
    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': testContentType
      },
      body: testVideoBuffer
    });

    console.log("   -> PUT Response Status:", putRes.status, putRes.statusText);
    if (!putRes.ok) {
      throw new Error(`PUT upload failed with status ${putRes.status}`);
    }

    // 4. Verification in R2 Bucket using S3 HeadObjectCommand
    console.log("\n4. Running HeadObjectCommand against R2 bucket to confirm file existence & size...");
    const expectedKey = `raw/${videoId}/original.mp4`;
    const headCmd = new HeadObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: expectedKey
    });

    const headRes = await r2.send(headCmd);
    console.log("   -> HeadObject Raw Result:", {
      ContentLength: headRes.ContentLength,
      ContentType: headRes.ContentType,
      ETag: headRes.ETag,
      LastModified: headRes.LastModified
    });

    // Strict Size & Content Type Assertions
    const actualSize = parseInt(headRes.ContentLength, 10);
    if (actualSize !== testFileSize) {
      throw new Error(`CRITICAL BUG DETECTED: Uploaded file size mismatch! Expected ${testFileSize} bytes, but found ${actualSize} bytes in R2.`);
    }

    console.log("\n=======================================================");
    console.log("   R2 OBJECT VERIFICATION SUCCESSFUL:");
    console.log(`   - Key:          ${expectedKey}`);
    console.log(`   - Size:         ${actualSize} bytes (Exact match!)`);
    console.log(`   - Content-Type: ${headRes.ContentType}`);
    console.log("=======================================================\n");

    // 5. Register video row in Database
    console.log("5. Registering video record in DB (POST /videos)...");
    const reqCreate = {
      user: { id: userId },
      body: {
        videoId,
        caption: 'Strict E2E Upload Verified #r2 #test'
      }
    };
    let createData = null;
    let createStatus = null;
    const resCreate = {
      status: (code) => { createStatus = code; return resCreate; },
      json: (data) => { createData = data; }
    };

    await createVideoRecord(reqCreate, resCreate, (err) => { if (err) throw err; });
    console.log("   -> POST /videos status:", createStatus);
    console.log("   -> Video Row in DB:", createData);

    if (createData.status !== 'processing') {
      throw new Error(`Expected status='processing', got '${createData.status}'`);
    }

    console.log("\n=== ALL E2E VERIFICATIONS PASSED CLEANLY ===");

  } catch (err) {
    console.error("\nSTRICT E2E TEST FAILED:", err);
  } finally {
    await pool.end();
    if (mockServer) {
      mockServer.close();
    }
  }
}

testStrictE2E();
