// worker/videoProcessorMerged.js
// Integrated version of the video processor designed to run in-process with the main Express server.

const path = require('path');
const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static'); // bundled ffmpeg binary
const ffprobePath = require('@ffprobe-installer/ffprobe').path; // bundled ffprobe binary
const pool = require('../src/db/pool');
const s3 = require('../src/config/r2');
const { GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { claimVideoForTranscoding } = require('../src/db/videoQueries');
const { checkFfmpegInstalled } = require('../src/utils/checkFfmpeg');

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
  const cmd = `"${ffprobePath}" -v error -select_streams v:0 -show_entries stream=width,height -of json "${filePath}"`;
  const out = execSync(cmd, { encoding: 'utf8' });
  const info = JSON.parse(out);
  const { width, height } = info.streams[0] || {};
  return { width, height };
}

function extractThumbnail(inputPath, outputPath) {
  const cmd = `"${ffmpegPath}" -y -i "${inputPath}" -ss 00:00:01 -vframes 1 "${outputPath}"`;
  execSync(cmd, { stdio: 'ignore' });
}

function transcodeIfNeeded(inputPath, outputPath) {
  const { width } = getVideoResolution(inputPath);
  const targetWidth = 1280; // 720p width approx (1280x720)
  if (width && width <= targetWidth) {
    fs.copyFileSync(inputPath, outputPath);
    return false;
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

async function updateVideoStatusDirectly(videoId, cdnUrl, thumbnailUrl, durationMs) {
  // Directly update status in DB since worker is running in-process
  const { updateVideoStatus } = require('../src/db/videoQueries');
  const result = await updateVideoStatus(videoId, {
    status: 'ready',
    cdnUrl,
    thumbnailUrl,
    durationMs,
  });
  if (!result) {
    throw new Error(`Failed to update video status in database for video ${videoId}`);
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
    transcodeIfNeeded(rawPath, outVideoPath);

    // 4. get duration
    const durationMs = getDurationMs(rawPath);

    // 5. upload assets
    const thumbKey = `videos/${videoId}/thumbnail.jpg`;
    const videoKey = `videos/${videoId}/720p.mp4`;
    await uploadFile(thumbPath, thumbKey, 'image/jpeg');
    await uploadFile(outVideoPath, videoKey, 'video/mp4');

    const cdnUrl = `${process.env.CDN_BASE_URL || ''}/videos/${videoId}/720p.mp4`;
    const thumbnailUrl = `${process.env.CDN_BASE_URL || ''}/videos/${videoId}/thumbnail.jpg`;

    // 6. update status directly in DB
    await updateVideoStatusDirectly(videoId, cdnUrl, thumbnailUrl, durationMs);
  } finally {
    // cleanup temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

let pollingActive = false;

function startInternalWorker() {
  if (pollingActive) return;
  pollingActive = true;

  if (!checkFfmpegInstalled()) {
    console.warn('[worker] WARNING: ffmpeg is not installed or not in PATH. In-process video processing disabled.');
    return;
  }

  console.log('[worker] Integrated video processor started – polling every 5 seconds');

  const pollInterval = setInterval(async () => {
    try {
      // Find a video in processing state – we just need an id.
      const { rows } = await pool.query(`SELECT id FROM videos WHERE status = 'processing' LIMIT 1`);
      if (rows.length === 0) {
        return;
      }
      const videoId = rows[0].id;
      // Attempt to claim it atomically
      const claimed = await claimVideoForTranscoding(videoId);
      if (!claimed) {
        // another concurrent task claimed it; skip
        return;
      }
      console.log(`[worker] Claimed video ${videoId} for transcoding`);
      // Run async process in background, freeing up the interval timer loop
      processVideo(claimed)
        .then(() => {
          console.log(`[worker] Finished processing video ${videoId}`);
        })
        .catch(err => {
          console.error(`[worker] Error processing video ${videoId}:`, err);
          // Try to set status to failed
          const { updateVideoStatus } = require('../src/db/videoQueries');
          updateVideoStatus(videoId, { status: 'failed' }).catch(cleanupErr => {
            console.error(`[worker] Failed to flag video ${videoId} as failed:`, cleanupErr);
          });
        });
    } catch (err) {
      console.error('[worker] Polling iteration error:', err);
    }
  }, 5000);

  // Allow cleanly stopping the interval if needed (e.g. for testing)
  return () => clearInterval(pollInterval);
}

module.exports = { startInternalWorker };
