require('dotenv').config();
const pool = require('./src/db/pool');

async function testDevUploadFlow() {
  console.log("=== TESTING LOCAL DEV UPLOAD FALLBACK ===");
  try {
    // 1. Get user
    const userRes = await pool.query(`
      INSERT INTO users (handle, email, password_hash)
      VALUES ('dev_upload_user', 'dev_upload@example.com', 'hash')
      ON CONFLICT (handle) DO UPDATE SET handle = EXCLUDED.handle
      RETURNING id;
    `);
    const userId = userRes.rows[0].id;

    // 2. Call getUploadUrl
    const { getUploadUrl } = require('./src/controllers/videoController');
    const reqGetUrl = { user: { id: userId }, headers: { host: 'localhost:4000' }, protocol: 'http' };
    let getUrlData = null;
    const resGetUrl = { json: (data) => { getUrlData = data; } };

    await getUploadUrl(reqGetUrl, resGetUrl, (err) => { if (err) throw err; });
    console.log("Upload URL Data:", getUrlData);

    if (!getUrlData.uploadUrl.includes('/videos/dev-upload/')) {
      throw new Error(`Expected dev upload URL, got: ${getUrlData.uploadUrl}`);
    }

    console.log("SUCCESS: Dev upload fallback generates a local backend upload URL when live R2 keys are not present in .env.");

  } catch (err) {
    console.error("Test failed:", err);
  } finally {
    await pool.end();
  }
}

testDevUploadFlow();
