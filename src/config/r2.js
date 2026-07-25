const { S3Client } = require('@aws-sdk/client-s3');

const endpoint = process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

const r2 = new S3Client({
  endpoint,
  region: 'auto',
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID || 'test',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || 'test',
  },
  forcePathStyle: !!process.env.R2_ENDPOINT,
});

module.exports = r2;
