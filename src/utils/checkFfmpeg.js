const { execSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static'); // bundled ffmpeg binary

function checkFfmpegInstalled() {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch (_) {
    try {
      execSync(`"${ffmpegPath}" -version`, { stdio: 'ignore' });
      // expose for worker usage
      process.env.FFMPEG_PATH = ffmpegPath;
      return true;
    } catch (_) {
      return false;
    }
  }
}

module.exports = { checkFfmpegInstalled };
