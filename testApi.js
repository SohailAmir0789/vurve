const http = require('http');

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function request(path, method = 'GET', body = null, token = null) {
  const options = {
    hostname: 'localhost',
    port: 4000,
    path,
    method,
    headers: {
      'Content-Type': 'application/json'
    }
  };

  if (token) {
    options.headers['Authorization'] = `Bearer ${token}`;
  }

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : null;
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function main() {
  console.log('--- Testing Vurve API ---');

  // 1. Health Check
  console.log('\n[1] Testing Health Check...');
  const health = await request('/health');
  console.log('Health:', health.status, health.data);
  if (health.status !== 200) {
    console.log('Server is not running on port 4000. Start it with `npm run dev` in another terminal.');
    return;
  }

  const randomHandle = `user${Math.floor(Math.random() * 10000)}`;
  const randomEmail = `${randomHandle}@example.com`;
  const password = 'password123';

  // 2. Signup
  console.log(`\n[2] Testing Signup (${randomHandle})...`);
  const signup = await request('/auth/signup', 'POST', {
    handle: randomHandle,
    email: randomEmail,
    password: password,
    display_name: 'Test User'
  });
  console.log('Signup:', signup.status, signup.data);

  // 3. Login
  console.log('\n[3] Testing Login...');
  const login = await request('/auth/login', 'POST', {
    email: randomEmail,
    password: password
  });
  console.log('Login:', login.status, login.data);
  
  if (login.status !== 200) {
    console.error('Login failed, stopping test.');
    return;
  }

  const token = login.data.token;

  // 4. Get ME
  console.log('\n[4] Testing /auth/me...');
  const me = await request('/auth/me', 'GET', null, token);
  console.log('Me:', me.status, me.data);

  // 5. Upload URL
  console.log('\n[5] Testing Get Upload URL...');
  const uploadUrl = await request('/videos/upload-url', 'POST', null, token);
  console.log('Upload URL:', uploadUrl.status, uploadUrl.data);
  
  const videoId = uploadUrl.data?.videoId;

  // 6. Create Video Record
  if (videoId) {
    console.log(`\n[6] Testing Create Video (${videoId})...`);
    const createVideo = await request('/videos', 'POST', {
      videoId: videoId,
      caption: 'My first test video!'
    }, token);
    console.log('Create Video:', createVideo.status, createVideo.data);

    // 7. Update Video Status (Internal endpoint)
    // Wait, we need the internal worker secret from .env
    // We don't have the secret, let's skip or try to fetch it if we can
    // Or we can just test social endpoints

    // 8. Like Video
    console.log('\n[7] Testing Like Video...');
    const like = await request(`/videos/${videoId}/like`, 'POST', null, token);
    console.log('Like Video:', like.status, like.data);

    // 9. Comment on Video
    console.log('\n[8] Testing Comment on Video...');
    const comment = await request(`/videos/${videoId}/comments`, 'POST', {
      body: 'Great test video!'
    }, token);
    console.log('Comment:', comment.status, comment.data);

    // 10. List Comments
    console.log('\n[9] Testing List Comments...');
    const listComments = await request(`/videos/${videoId}/comments`, 'GET');
    console.log('List Comments:', listComments.status, listComments.data);
  }

  // 11. Public Profile
  console.log(`\n[10] Testing Public Profile for ${randomHandle}...`);
  const profile = await request(`/users/${randomHandle}`, 'GET');
  console.log('Profile:', profile.status, profile.data);
  
  console.log('\n--- Tests Complete ---');
}

main().catch(console.error);
