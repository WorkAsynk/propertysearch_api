const multer = require('multer');

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

function fileFilter(allowedTypes) {
  return (req, file, cb) => {
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  };
}

// Property media: images or videos, up to 100MB (videos are the large case).
const uploadPropertyMedia = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: fileFilter([...IMAGE_TYPES, ...VIDEO_TYPES]),
});

// Profile pictures: images only, up to 5MB.
const uploadProfilePicture = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: fileFilter(IMAGE_TYPES),
});

module.exports = { uploadPropertyMedia, uploadProfilePicture, IMAGE_TYPES, VIDEO_TYPES };
