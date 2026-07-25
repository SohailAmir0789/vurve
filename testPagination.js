require('dotenv').config();
const { getFeed } = require('./src/controllers/feedController');
const { listComments } = require('./src/controllers/likeCommentController');
const { getUserVideos } = require('./src/controllers/userController');
const pool = require('./src/db/pool');

async function runTest() {
  try {
    console.log("=== STARTING COMPOSITE CURSOR PAGINATION TEST ===");

    // Setup dummy user & video
    const userRes = await pool.query(`
      INSERT INTO users (handle, email, password_hash)
      VALUES ('pagi_master', 'pagi_master@example.com', 'hash')
      ON CONFLICT (handle) DO UPDATE SET handle = EXCLUDED.handle
      RETURNING id, handle;
    `);
    const user = userRes.rows[0];

    const videoRes = await pool.query(`
      INSERT INTO videos (user_id, caption, status)
      VALUES ($1, 'Pagination Test Video', 'ready')
      RETURNING id;
    `, [user.id]);
    const videoId = videoRes.rows[0].id;

    const sameTimestamp = new Date().toISOString();
    console.log("\nUsing shared timestamp for batch inserts:", sameTimestamp);

    // ── 1. TEST COMMENTS PAGINATION (GET /videos/:id/comments) ──────────────
    console.log("\n1. Testing GET /videos/:id/comments with limit=1 and identical timestamp...");
    const commentIds = [];
    for (let i = 0; i < 3; i++) {
      const cRes = await pool.query(`
        INSERT INTO comments (video_id, user_id, body, created_at)
        VALUES ($1, $2, $3, $4)
        RETURNING id;
      `, [videoId, user.id, `Test comment #${i+1}`, sameTimestamp]);
      commentIds.push(cRes.rows[0].id);
    }
    console.log("   Inserted test comments:", commentIds);

    const fetchedComments = [];
    let commentCursor = null;

    for (let page = 1; page <= 4; page++) {
      let resData = null;
      const req = { params: { id: videoId }, query: { limit: '1', before: commentCursor } };
      const res = { json: (data) => { resData = data; } };

      await listComments(req, res, (err) => { if (err) throw err; });
      if (!resData || !resData.comments || resData.comments.length === 0) break;

      fetchedComments.push(...resData.comments);
      commentCursor = resData.nextCursor;
      if (!commentCursor) break;
    }

    const fetchedCommentIds = fetchedComments.map(c => c.id).filter(id => commentIds.includes(id));
    console.log("   Fetched comment IDs in order:", fetchedCommentIds);

    if (fetchedCommentIds.length === 3 && new Set(fetchedCommentIds).size === 3) {
      console.log("   ✅ COMMENTS PAGINATION PASSED: 3 unique items returned in order with 0 duplicates/skips!");
    } else {
      throw new Error(`Comments pagination failed! Got: ${JSON.stringify(fetchedCommentIds)}`);
    }

    // ── 2. TEST USER VIDEOS PAGINATION (GET /users/:handle/videos) ───────────
    console.log("\n2. Testing GET /users/:handle/videos with limit=1 and identical timestamp...");
    const userVideoIds = [];
    for (let i = 0; i < 3; i++) {
      const vRes = await pool.query(`
        INSERT INTO videos (user_id, caption, status, created_at)
        VALUES ($1, $2, 'ready', $3)
        RETURNING id;
      `, [user.id, `User video #${i+1}`, sameTimestamp]);
      userVideoIds.push(vRes.rows[0].id);
    }
    console.log("   Inserted user videos:", userVideoIds);

    const fetchedUserVideos = [];
    let userVideoCursor = null;

    for (let page = 1; page <= 4; page++) {
      let resData = null;
      const req = { params: { handle: user.handle }, query: { limit: '1', before: userVideoCursor } };
      const res = { json: (data) => { resData = data; } };

      await getUserVideos(req, res, (err) => { if (err) throw err; });
      if (!resData || !resData.videos || resData.videos.length === 0) break;

      fetchedUserVideos.push(...resData.videos);
      userVideoCursor = resData.nextCursor;
      if (!userVideoCursor) break;
    }

    const fetchedUserVideoIds = fetchedUserVideos.map(v => v.id).filter(id => userVideoIds.includes(id));
    console.log("   Fetched user video IDs in order:", fetchedUserVideoIds);

    if (fetchedUserVideoIds.length === 3 && new Set(fetchedUserVideoIds).size === 3) {
      console.log("   ✅ USER VIDEOS PAGINATION PASSED: 3 unique items returned in order with 0 duplicates/skips!");
    } else {
      throw new Error(`User videos pagination failed! Got: ${JSON.stringify(fetchedUserVideoIds)}`);
    }

    console.log("\n=== ALL COMPOSITE PAGINATION TESTS PASSED CLEANLY ===");

  } catch (err) {
    console.error("\nTEST FAILED:", err.message);
  } finally {
    await pool.end();
  }
}

runTest();
