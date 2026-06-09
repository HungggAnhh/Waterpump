// backend/services/voiceProcessor.js
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

/**
 * Transcodes an input audio file to standardized AAC-LC M4A.
 * @param {string} inputPath - Absolute path to input audio file
 * @param {string} outputPath - Absolute path to output M4A file
 * @returns {Promise<void>}
 */
function transcodeToAAC(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    // FFmpeg options:
    // -y: overwrite output files
    // -i: input file
    // -c:a aac: AAC audio codec
    // -b:a 128k: 128kbps bitrate
    // -ar 44100: 44100Hz sample rate
    // -ac 1: mono channel
    const args = [
      '-y',
      '-i', inputPath,
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-ac', '1',
      outputPath
    ];

    const proc = spawn(ffmpegPath, args);

    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Checks if a mime type requires transcoding.
 * @param {string} mimeType 
 * @returns {boolean}
 */
function shouldTranscode(mimeType) {
  if (!mimeType) return false;
  const cleanMime = mimeType.split(';')[0].toLowerCase().trim();
  
  // Transcode: audio/webm, audio/ogg
  if (cleanMime === 'audio/webm' || cleanMime === 'audio/ogg') {
    return true;
  }
  
  // Skip: audio/m4a, audio/mp4, audio/aac (and default to skip others)
  return false;
}

module.exports = {
  transcodeToAAC,
  shouldTranscode
};
