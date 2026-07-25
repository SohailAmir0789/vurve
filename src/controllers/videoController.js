const { PutObjectCommand }  = require('@aws-sdk/client-s3');
const { getSignedUrl }      = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4, validate: uuidValidate } = require('uuid');

const r2 = require('../config/r2');
const { createVideo, findVideoByIdAndUser, updateVideoStatus } = require('../db/videoQueries');

// ── Constants ─────────────────────────────────────────────────────────────────

const PRESIGN_TTL_SECONDS = 3600; // 1 hour

// Only allow these transitions from the transcoding worker
const VALID_TRANSITIONS = {
  processing: new Set(['ready', 'failed']),
};

// ── Controllers ───────────────────────────────────────────────────────────────

/**
 * POST /videos/upload-url  (protected)
 *
 * Generates a video id and a pre-signed PUT URL for the raw upload.
 * Does NOT touch the database — the client confirms the upload succeeded
 * via POST /videos before the row is created.
 */
async function getUploadUrl(req, res, next) {
  try {
    const videoId   = uuidv4();
    const objectKey = `raw/${videoId}/original.mp4`;

    const isPlaceholder = !process.env.R2_ACCOUNT_ID || process.env.R2_ACCOUNT_ID === 'your_cloudflare_account_id';

    if (isPlaceholder) {
      // Local dev fallback URL when live R2 credentials are not set
      const port = process.env.PORT || 4000;
      const host = req.headers.host || `localhost:${port}`;
      const protocol = req.protocol || 'http';
      const uploadUrl = `${protocol}://${host}/videos/dev-upload/${videoId}`;
      return res.json({ videoId, uploadUrl });
    }

    const command = new PutObjectCommand({
      Bucket:      process.env.R2_BUCKET,
      Key:         objectKey,
      ContentType: 'video/mp4',
    });

    const uploadUrl = await getSignedUrl(r2, command, {
      expiresIn: PRESIGN_TTL_SECONDS,
    });

    return res.json({ videoId, uploadUrl });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /videos  (protected)
 *
 * Called by the client after the file has been PUT to R2.
 * Inserts the video row with status='processing'.
 * Body: { videoId, caption? }
 */
async function createVideoRecord(req, res, next) {
  try {
    const { videoId, caption } = req.body;

    // ── Validate videoId ────────────────────────────────────────────────────
    if (!videoId || !uuidValidate(videoId)) {
      return res.status(400).json({ error: 'videoId must be a valid UUID' });
    }

    // ── Duplicate-insert guard ──────────────────────────────────────────────
    const existing = await findVideoByIdAndUser(videoId, req.user.id);
    if (existing) {
      return res.status(409).json({ error: 'A video with that id already exists for this account' });
    }

    const video = await createVideo({
      id:     videoId,
      userId: req.user.id,
      caption,
    });

    return res.status(201).json(video);
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /videos/:id/status  (internal — X-Internal-Secret)
 *
 * Called by the transcoding worker once encoding is done.
 * Only allows: processing → ready | processing → failed.
 * Body: { status, cdn_url?, thumbnail_url?, duration_ms? }
 */
async function updateStatus(req, res, next) {
  try {
    const { id }                                                  = req.params;
    const { status, cdn_url: cdnUrl, thumbnail_url: thumbnailUrl, duration_ms: durationMs } = req.body;

    // ── Validate incoming status value ──────────────────────────────────────
    const allowedStatuses = ['ready', 'failed'];
    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({
        error: `status must be one of: ${allowedStatuses.join(', ')}`,
      });
    }

    if (!id || !uuidValidate(id)) {
      return res.status(400).json({ error: 'id must be a valid UUID' });
    }

    // ── Fetch current row to verify the transition is legal ─────────────────
    // We do a conditional UPDATE that also checks current status = 'processing'
    // to avoid racing transitions or double-updates.
    const { rows } = await require('../db/pool').query(
      `UPDATE videos
       SET status        = $2,
           cdn_url       = COALESCE($3, cdn_url),
           thumbnail_url = COALESCE($4, thumbnail_url),
           duration_ms   = COALESCE($5, duration_ms),
           updated_at    = now()
       WHERE id = $1
         AND status = 'processing'
       RETURNING id, user_id, caption, status, cdn_url, thumbnail_url,
                 duration_ms, like_count, comment_count, view_count,
                 created_at, updated_at`,
      [id, status, cdnUrl ?? null, thumbnailUrl ?? null, durationMs ?? null],
    );

    if (rows.length === 0) {
      // Either the video doesn't exist or it wasn't in 'processing' state
      return res.status(409).json({
        error: 'Video not found or is not in processing state — transition rejected',
      });
    }

    return res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

const fs = require('fs');
const path = require('path');

const DEV_UPLOADS_DIR = path.join(__dirname, '../../dev_uploads');
if (!fs.existsSync(DEV_UPLOADS_DIR)) {
  fs.mkdirSync(DEV_UPLOADS_DIR, { recursive: true });
}

async function handleDevUpload(req, res, next) {
  try {
    const { videoId } = req.params;
    console.log(`[dev-upload] Received local upload stream for videoId: ${videoId}`);
    
    // Save file buffer if present
    if (req.body && req.body.length > 0) {
      const filePath = path.join(DEV_UPLOADS_DIR, `${videoId}.mp4`);
      fs.writeFileSync(filePath, req.body);
    }

    const cdnUrl = `http://localhost:4000/videos/dev-upload/${videoId}`;

    // Auto-update video status to 'ready' and set cdn_url for local playback
    await require('../db/pool').query(
      `UPDATE videos SET status = 'ready', cdn_url = $2 WHERE id = $1`,
      [videoId, cdnUrl]
    );

    return res.status(200).send('OK');
  } catch (err) {
    next(err);
  }
}

async function serveDevVideo(req, res, next) {
  try {
    const { videoId } = req.params;
    const filePath = path.join(DEV_UPLOADS_DIR, `${videoId}.mp4`);

    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }

    // Fallback to sample MP4 if local file not found
    return res.redirect('https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4');
  } catch (err) {
    next(err);
  }
}

module.exports = { getUploadUrl, createVideoRecord, updateStatus, handleDevUpload, serveDevVideo };
