// worker/videoProcessor.js
// Background worker that polls for videos with status 'processing', claims them, processes via ffmpeg, uploads assets, and updates status.

require('dotenv').config();
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static'); // bundled ffmpeg binary
const ffprobePath = require('@ffprobe-installer/ffprobe').path; // bundled ffprobe binary
const { Pool } = require('pg');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
// using built‑in fetch (Node >=18)

const { claimVideoForTranscoding } = require('../src/db/videoQueries');
const { checkFfmpegInstalled } = require('../src/utils/checkFfmpeg');

// PostgreSQL pool (reuse same config as server)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// S3 client for Cloudflare R2 (needs endpoint)
const s3 = new S3Client({
  region: process.env.R2_REGION,
  endpoint: process.env.R2_ENDPOINT, // e.g., https://<account-id>.r2.cloudflarestorage.com
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET || 'vurve-assets';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || '';

async function downloadRaw(videoId) {
  const key = `raw/${videoId}/original.mp4`;
  const getCmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  const response = await s3.send(getCmd);
  const tmpPath = path.join(os.tmpdir(), `${videoId}_original.mp4`);
  const writeStream = fs.createWriteStream(tmpPath);
  await new Promise((resolve, reject) => {
    response.Body.pipe(writeStream)
      .on('error', reject)
      .on('close', resolve);
  });
  return tmpPath;
}

async function uploadFile(localPath, destKey, contentType) {
  const fileStream = fs.createReadStream(localPath);
  const putCmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: destKey,
    Body: fileStream,
    ContentType: contentType,
  });
  await s3.send(putCmd);
}

function getVideoResolution(filePath) {
  // Use ffprobe to get width & height
  const cmd = `"${ffprobePath}" -v error -select_streams v:0 -show_entries stream=width,height -of json "${filePath}"`;
  const out = execSync(cmd, { encoding: 'utf8' });
  const info = JSON.parse(out);
  const { width, height } = info.streams[0] || {};
  return { width, height };
}

function extractThumbnail(inputPath, outputPath) {
  // Extract a frame at 1 second
  const cmd = `"${ffmpegPath}" -y -i "${inputPath}" -ss 00:00:01 -vframes 1 "${outputPath}"`;
  execSync(cmd, { stdio: 'ignore' });
}

function transcodeIfNeeded(inputPath, outputPath) {
  const { width } = getVideoResolution(inputPath);
  const targetWidth = 1280; // 720p width approx (1280x720)
  if (width && width <= targetWidth) {
    // No need to transcode, just copy
    fs.copyFileSync(inputPath, outputPath);
    return false; // indicates copy
  }
  const cmd = `"${ffmpegPath}" -y -i "${inputPath}" -vf "scale=${targetWidth}:-2" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k "${outputPath}"`;
  execSync(cmd, { stdio: 'ignore' });
  return true;
}

function getDurationMs(filePath) {
  const cmd = `"${ffprobePath}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
  const out = execSync(cmd, { encoding: 'utf8' }).trim();
  const seconds = parseFloat(out);
  return Math.round(seconds * 1000);
}

async function updateVideoStatus(videoId, cdnUrl, thumbnailUrl, durationMs) {
  const endpoint = `${process.env.INTERNAL_API_URL || 'http://localhost:3000'}/videos/${videoId}/status`;
  const resp = await fetch(endpoint, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': INTERNAL_SECRET,
    },
    body: JSON.stringify({
      status: 'ready',
      cdn_url: cdnUrl,
      thumbnail_url: thumbnailUrl,
      duration_ms: durationMs,
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Failed to update video status: ${resp.status} ${txt}`);
  }
}

async function processVideo(video) {
  const videoId = video.id;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `${videoId}_`));
  const rawPath = path.join(tmpDir, 'original.mp4');
  const thumbPath = path.join(tmpDir, 'thumbnail.jpg');
  const outVideoPath = path.join(tmpDir, 'output.mp4');

  try {
    // 1. download raw
    const downloaded = await downloadRaw(videoId);
    fs.copyFileSync(downloaded, rawPath);

    // 2. thumbnail
    extractThumbnail(rawPath, thumbPath);

    // 3. transcode / copy
    const didTranscode = transcodeIfNeeded(rawPath, outVideoPath);

    // 4. get duration
    const durationMs = getDurationMs(rawPath);

    // 5. upload assets
    const thumbKey = `videos/${videoId}/thumbnail.jpg`;
    const videoKey = `videos/${videoId}/720p.mp4`;
    await uploadFile(thumbPath, thumbKey, 'image/jpeg');
    await uploadFile(outVideoPath, videoKey, 'video/mp4');

    const cdnUrl = `${process.env.CDN_BASE_URL || ''}/videos/${videoId}/720p.mp4`;
    const thumbnailUrl = `${process.env.CDN_BASE_URL || ''}/videos/${videoId}/thumbnail.jpg`;

    // 6. update status
    await updateVideoStatus(videoId, cdnUrl, thumbnailUrl, durationMs);
  } finally {
    // cleanup temp directory recursively
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

async function pollAndProcess() {
  if (!checkFfmpegInstalled()) {
    console.error('ffmpeg is not installed or not in PATH. Worker exiting.');
    process.exit(1);
  }
  console.log('Video worker started – polling every 5 seconds');
  while (true) {
    try {
      // Find a video in processing state – we just need an id.
      const { rows } = await pool.query(`SELECT id FROM videos WHERE status = 'processing' LIMIT 1`);
      if (rows.length === 0) {
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      const videoId = rows[0].id;
      // Attempt to claim it atomically
      const claimed = await claimVideoForTranscoding(videoId);
      if (!claimed) {
        // another worker claimed it; skip
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      console.log(`Claimed video ${videoId} for transcoding`);
      await processVideo(claimed);
      console.log(`Finished processing video ${videoId}`);
    } catch (err) {
      console.error('Worker error:', err);
      // wait a bit before next iteration to avoid tight error loops
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

pollAndProcess();
